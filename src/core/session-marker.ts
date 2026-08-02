import type { TokenSet, TokenStorage } from "./storage.js";

/** Name of the non-secret cookie that tells a server "this browser believes
 *  it has a session". */
export const SESSION_MARKER_COOKIE = "gateward.authed";

export interface SessionMarkerOptions {
  /** Cookie name (default {@link SESSION_MARKER_COOKIE}). */
  name?: string;
  /** Lifetime in seconds — match your refresh token TTL (default 30 days). */
  maxAgeSec?: number;
  /** Cookie path (default `/`). */
  path?: string;
}

/** Wrap a {@link TokenStorage} so it also maintains a **non-secret marker
 *  cookie** next to the tokens.
 *
 *  Tokens live in Web Storage, which a server never sees, so an SSR framework
 *  cannot tell a signed-in request from a signed-out one and every protected
 *  route renders a redirecting shell. This cookie closes that gap: it carries
 *  no credential, only the fact that a session is believed to exist.
 *
 *  **It is not authentication.** A user can set it by hand; all that buys
 *  them is a server-rendered layout, because every API call still needs a
 *  real token and answers 401 without one. Never authorize on it. */
export function withSessionMarker(
  storage: TokenStorage,
  opts: SessionMarkerOptions = {},
): TokenStorage {
  const name = opts.name ?? SESSION_MARKER_COOKIE;
  const maxAge = opts.maxAgeSec ?? 60 * 60 * 24 * 30;
  const path = opts.path ?? "/";

  return {
    get: () => storage.get(),
    async set(tokens: TokenSet) {
      await storage.set(tokens);
      writeMarker(name, maxAge, path);
    },
    async clear() {
      await storage.clear();
      clearMarker(name, path);
    },
  };
}

/** Read the marker from a `Cookie` header — the one form available in every
 *  runtime (Next middleware, a Remix loader, a plain Request). */
export function hasSessionMarker(
  cookieHeader: string | null | undefined,
  name: string = SESSION_MARKER_COOKIE,
): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((part) => part.trim().startsWith(`${name}=`) && !part.trim().endsWith("="));
}

function writeMarker(name: string, maxAge: number, path: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=1; Path=${path}; Max-Age=${maxAge}; SameSite=Lax${secureFlag()}`;
}

function clearMarker(name: string, path: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=${path}; Max-Age=0; SameSite=Lax${secureFlag()}`;
}

/** `Secure` would make the cookie unwritable over plain http, which is how
 *  every local dev server runs. */
function secureFlag(): string {
  return typeof location !== "undefined" && location.protocol === "https:"
    ? "; Secure"
    : "";
}
