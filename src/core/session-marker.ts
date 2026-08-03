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

/** Wrap a {@link TokenStorage} so it also maintains the marker cookie.
 *
 *  NOT authentication — it is forgeable and carries no credential; forging it
 *  yields an empty shell. See docs/ARCHITECTURE/SESSION.md. */
export function withSessionMarker(
  storage: TokenStorage,
  opts: SessionMarkerOptions = {},
): TokenStorage {
  const name = opts.name ?? SESSION_MARKER_COOKIE;
  const maxAge = opts.maxAgeSec ?? 60 * 60 * 24 * 30;
  const path = opts.path ?? "/";

  const wrapped: TokenStorage = {
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
  // Forwarded, or wrapping would silently disable cross-tab sync.
  if (storage.subscribe) {
    wrapped.subscribe = (listener) => storage.subscribe!(listener);
  }
  return wrapped;
}

/** Read the marker from a `Cookie` header. */
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

/** Omitted on http, or the cookie would be unwritable in local dev. */
function secureFlag(): string {
  return typeof location !== "undefined" && location.protocol === "https:"
    ? "; Secure"
    : "";
}
