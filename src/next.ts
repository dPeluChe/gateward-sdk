// Server-side gating for SSR frameworks. Deliberately imports nothing from
// `next` — it speaks only Web-standard Request/Response, so the same helper
// works in Next middleware, a Remix loader, SvelteKit hooks, or Hono.
import {
  SESSION_MARKER_COOKIE,
  hasSessionMarker,
} from "./core/session-marker.js";

export {
  SESSION_MARKER_COOKIE,
  hasSessionMarker,
  withSessionMarker,
  type SessionMarkerOptions,
} from "./core/session-marker.js";

/** The slice of a request this needs — satisfied by `NextRequest`, `Request`,
 *  and anything else Web-standard. */
export interface GatewardRequest {
  url: string;
  headers: { get(name: string): string | null };
}

export interface MiddlewareOptions {
  /** Paths that require a session. A prefix list, or your own predicate. */
  protect: string[] | ((pathname: string) => boolean);
  /** Where to send a signed-out visitor (default `/login`). */
  loginPath?: string;
  /** Where to send a signed-in visitor who opens {@link loginPath} — set it
   *  so a logged-in user doesn't land back on the login screen. */
  authenticatedHome?: string;
  /** Query param carrying the originally requested path, so login can bounce
   *  back. `false` to omit (default `"next"`). */
  returnTo?: string | false;
  /** Marker cookie name — must match the one the client writes. */
  cookieName?: string;
  /** Status for the redirect (default 307, preserves the method). */
  status?: number;
}

/** Build a middleware that redirects on the **marker cookie** alone.
 *
 *  This is a rendering optimization, not a security boundary: it decides
 *  whether the server bothers rendering an authed layout. The cookie is
 *  forgeable and carries no credential, so forging it only yields an empty
 *  shell — every data call still needs a real token. Authorize in your API,
 *  never here.
 *
 *  ```ts
 *  // middleware.ts
 *  export const middleware = createGatewardMiddleware({
 *    protect: ["/dashboard", "/settings"],
 *    authenticatedHome: "/dashboard",
 *  });
 *  ```
 *
 *  Returns `undefined` when the request should proceed — in Next, `return
 *  gatewardMiddleware(request) ?? NextResponse.next()`. */
export function createGatewardMiddleware(opts: MiddlewareOptions) {
  const loginPath = opts.loginPath ?? "/login";
  const returnTo = opts.returnTo === undefined ? "next" : opts.returnTo;
  const status = opts.status ?? 307;
  const isProtected =
    typeof opts.protect === "function"
      ? opts.protect
      : prefixMatcher(opts.protect);

  return function gatewardMiddleware(
    request: GatewardRequest,
  ): Response | undefined {
    const url = new URL(request.url);
    const authed = hasSessionMarker(
      request.headers.get("cookie"),
      opts.cookieName ?? SESSION_MARKER_COOKIE,
    );

    if (authed) {
      // Bounce a signed-in visitor off the login screen, but only when the
      // app said where to send them.
      if (opts.authenticatedHome && isSamePath(url.pathname, loginPath)) {
        return redirect(new URL(opts.authenticatedHome, url), status);
      }
      return undefined;
    }

    if (!isProtected(url.pathname)) return undefined;

    const target = new URL(loginPath, url);
    if (returnTo) {
      // Path + query only: a full URL here would let an open redirect through.
      target.searchParams.set(returnTo, url.pathname + url.search);
    }
    return redirect(target, status);
  };
}

function redirect(target: URL, status: number): Response {
  return new Response(null, {
    status,
    headers: { location: target.toString() },
  });
}

/** `/dashboard` protects `/dashboard` and `/dashboard/x`, but never
 *  `/dashboard-public`. */
function prefixMatcher(prefixes: string[]): (pathname: string) => boolean {
  return (pathname) =>
    prefixes.some(
      (prefix) =>
        pathname === prefix ||
        pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
    );
}

function isSamePath(pathname: string, other: string): boolean {
  return pathname === other || pathname === `${other}/`;
}
