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
  /** Server dropped the session — not an explicit `logout()`. Where a Next
   *  app does its hard redirect so middleware re-evaluates. */
  onSessionExpired?: () => void;
}

/** Owns the session state React renders from. */
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
  }, [injected, config]);

  const [user, setUser] = useState<GatewardUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<Error | null>(null);

  // Via ref so the subscription below survives a new inline closure.
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

  // A 401 here is the normal signed-out path; any other error must not
  // masquerade as it, or a blip bounces a valid session to /login.
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
      // token_refreshed: same identity — nothing to re-render.
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
    async (email: string, password: string): Promise<void> => {
      // Only signs in when the app skips email verification; the signed_in
      // subscription below then loads the user.
      await run(() => client.register(email, password));
    },
    [client, run],
  );

  const updateProfile = useCallback(
    async (metadata: Record<string, unknown>): Promise<void> => {
      setUser(await run(() => client.updateProfile(metadata)));
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
      updateProfile,
      logout,
      refreshUser,
    }),
    [
      client,
      user,
      status,
      error,
      login,
      register,
      updateProfile,
      logout,
      refreshUser,
    ],
  );

  return (
    <GatewardContext.Provider value={value}>
      {children}
    </GatewardContext.Provider>
  );
}

export type { AuthEvent };
