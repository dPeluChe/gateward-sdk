import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GatewardAuth, type GatewardAuthOptions } from "../auth/client.js";
import { GatewardError } from "../core/errors.js";
import type { AuthEvent } from "../core/events.js";
import type { TokenSet } from "../core/storage.js";
import type { GatewardUser } from "../core/types.js";
import {
  GatewardContext,
  type AuthStatus,
  type GatewardContextValue,
} from "./context.js";

export interface GatewardProviderProps {
  children: ReactNode;
  /** Pass a client you already built (shared with non-React code), or… */
  auth?: GatewardAuth;
  /** …the options to build one. Exactly one of the two is required. */
  config?: GatewardAuthOptions;
  /** Fired when the server drops the session out from under the app (a dead
   *  refresh token), *not* on an explicit `logout()`. This is where a Next.js
   *  app does its hard redirect so middleware re-evaluates. */
  onSessionExpired?: () => void;
}

/** Owns the session state React renders from: bootstraps the user on mount,
 *  then follows the client's auth events. */
export function GatewardProvider({
  children,
  auth: injected,
  config,
  onSessionExpired,
}: GatewardProviderProps) {
  const client = useMemo(() => {
    if (injected) return injected;
    if (config) return new GatewardAuth(config);
    throw new Error("<GatewardProvider> needs either `auth` or `config`");
    // A new client per render would drop the token cache and re-bootstrap.
  }, [injected, config]);

  const [user, setUser] = useState<GatewardUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<Error | null>(null);

  // Read through a ref so the event subscription below doesn't need to
  // re-bind every time the caller passes a new inline closure.
  const onExpired = useRef(onSessionExpired);
  useEffect(() => {
    onExpired.current = onSessionExpired;
  }, [onSessionExpired]);

  const loadUser = useCallback(
    async (force = false) => {
      const me = await client.getUser(force ? { force: true } : {});
      setUser(me);
      setStatus("authenticated");
    },
    [client],
  );

  // Bootstrap. A 401 here is the normal signed-out path, not a failure; any
  // other error (network, 500) must not masquerade as "signed out" — the app
  // would bounce a perfectly valid session to /login over a blip.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    client
      .getUser()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUser(null);
        setStatus("unauthenticated");
        if (!(err instanceof GatewardError && err.status === 401)) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    return client.onAuthStateChange(({ event }) => {
      if (event === "signed_in") {
        // The tokens are already stored; fetch the identity behind them.
        void loadUser(true).catch(() => {
          /* surfaced by the login() call that triggered this */
        });
        return;
      }
      if (event === "signed_out" || event === "session_expired") {
        setUser(null);
        setStatus("unauthenticated");
        if (event === "session_expired") onExpired.current?.();
      }
      // token_refreshed: same identity, new tokens — nothing to re-render.
    });
  }, [client, loadUser]);

  const run = useCallback(async <T,>(op: () => Promise<T>): Promise<T> => {
    setError(null);
    try {
      return await op();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, []);

  const login = useCallback(
    (email: string, password: string): Promise<TokenSet> =>
      run(() => client.login(email, password)),
    [client, run],
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      opts: { metadata?: Record<string, unknown> } = {},
    ): Promise<void> => {
      // Register issues no tokens — the Core requires email verification
      // first — so the session state deliberately does not change here.
      await run(() => client.register(email, password, opts));
    },
    [client, run],
  );

  const logout = useCallback(
    () => run(() => client.logout()),
    [client, run],
  );

  const refreshUser = useCallback(async () => {
    await loadUser(true);
  }, [loadUser]);

  const value = useMemo<GatewardContextValue>(
    () => ({
      auth: client,
      user,
      status,
      isAuthenticated: status === "authenticated",
      error,
      login,
      register,
      logout,
      refreshUser,
    }),
    [client, user, status, error, login, register, logout, refreshUser],
  );

  return (
    <GatewardContext.Provider value={value}>
      {children}
    </GatewardContext.Provider>
  );
}

export type { AuthEvent };
