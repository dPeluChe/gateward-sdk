import { GatewardError } from "./errors.js";
import type { FetchLike } from "./types.js";

/** The slice of {@link AuthSession} an authed fetch needs. */
export interface FetchSession {
  getAccessToken(): Promise<string>;
  refresh(): Promise<{ accessToken: string }>;
}

export interface AuthedFetchOptions {
  /** Restrict the `Authorization` header to these origins (e.g.
   *  `["https://api.myapp.com"]`). Omit to attach it to every request made
   *  through this fetch — fine when you hand it to one API client, dangerous
   *  as a global `fetch` replacement. Requests to other origins still go
   *  through, just unsigned. */
  origins?: string[];
  /** Refresh and retry once after a 401 from your API (default `true`). */
  retryOn401?: boolean;
  /** `fetch` to wrap (defaults to the global). */
  fetch?: FetchLike;
}

/** A `fetch` that signs requests with the session's access token: refreshes
 *  when the token is near expiry, and retries once on a 401 with a fresh one.
 *
 *  Drop-in for any client that takes a `fetch` (openapi-fetch, ky, an axios
 *  adapter). Every surveyed integrator hand-rolled this same interceptor.
 *
 *  Signed out is not an error: the request goes through unsigned so public
 *  endpoints keep working and your API answers with its own 401. */
export function createAuthedFetch(
  session: FetchSession,
  opts: AuthedFetchOptions = {},
): FetchLike {
  const base = opts.fetch ?? globalThis.fetch;
  if (!base) {
    throw new Error("No fetch available — pass `fetch` in the options.");
  }
  const retryOn401 = opts.retryOn401 ?? true;
  const origins = opts.origins?.map(normalizeOrigin);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldSign(urlOf(input), origins)) return base(input, init);

    // Cloned up front: building the signed request consumes the original's
    // body, so the retry below needs its own copy.
    const replay = isRequest(input) ? input.clone() : null;

    const token = await tokenOrNull(session);
    const [firstInput, firstInit] = sign(input, init, token);
    const first = await base(firstInput, firstInit);

    if (first.status !== 401 || !retryOn401 || !token) return first;

    let fresh: string;
    try {
      fresh = (await session.refresh()).accessToken;
    } catch {
      // The session is gone (AuthSession already emitted `session_expired`).
      // Hand back the real 401 instead of masking it with a refresh error.
      return first;
    }
    const [retryInput, retryInit] = sign(replay ?? input, init, fresh);
    return base(retryInput, retryInit);
  }) as FetchLike;
}

/** The current token, or `null` when there is no usable session. A 401 here
 *  means "not signed in", which is a normal state — anything else (network,
 *  5xx during refresh) is a real failure and propagates. */
async function tokenOrNull(session: FetchSession): Promise<string | null> {
  try {
    return await session.getAccessToken();
  } catch (err) {
    if (err instanceof GatewardError && err.status === 401) return null;
    throw err;
  }
}

function sign(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string | null,
): [RequestInfo | URL, RequestInit | undefined] {
  if (!token) return [input, init];
  if (isRequest(input)) {
    const headers = new Headers(input.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return [new Request(input, { headers }), init];
  }
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return [input, { ...init, headers }];
}

function shouldSign(url: string, origins: string[] | undefined): boolean {
  if (!origins) return true;
  try {
    return origins.includes(new URL(url).origin);
  } catch {
    // A relative URL is same-origin by definition, so an allowlist that
    // names the current origin should cover it.
    return typeof location !== "undefined" && origins.includes(location.origin);
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}
