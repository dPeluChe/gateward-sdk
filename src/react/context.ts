import { createContext, useContext } from "react";

import type { GatewardAuth } from "../auth/client.js";
import type { GatewardUser } from "../core/types.js";
import type { TokenSet } from "../core/storage.js";

/** Mirrors the three-state shape every surveyed app already models by hand.
 *  `loading` is the bootstrap window — an app that treats "no user yet" as
 *  "signed out" flashes the login screen on every reload. */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface GatewardContextValue {
  /** The underlying client — escape hatch for anything not wrapped here. */
  auth: GatewardAuth;
  user: GatewardUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  /** Last login/register/logout failure, cleared when the next one starts. */
  error: Error | null;
  login(email: string, password: string): Promise<TokenSet>;
  register(
    email: string,
    password: string,
    opts?: { metadata?: Record<string, unknown> },
  ): Promise<void>;
  logout(): Promise<void>;
  /** Re-read `/v1/auth/me` — call after your backend writes user metadata. */
  refreshUser(): Promise<void>;
}

export const GatewardContext = createContext<GatewardContextValue | null>(null);

/** Session state + actions. Throws outside {@link GatewardProvider}. */
export function useAuth(): GatewardContextValue {
  const ctx = useContext(GatewardContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <GatewardProvider>");
  }
  return ctx;
}

/** Just the current user — `null` while loading or signed out. */
export function useUser(): GatewardUser | null {
  return useAuth().user;
}
