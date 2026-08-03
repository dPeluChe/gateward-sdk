import { GatewardError } from "./errors.js";
import type { FetchLike } from "./types.js";

/** The slice of {@link AuthSession} an authed fetch needs. */
export interface FetchSession {
  getAccessToken(): Promise<string>;
  refresh(): Promise<{ accessToken: string }>;
}

export interface AuthedFetchOptions {
  /** Only sign these origins. Omit and EVERY request through this fetch is
   *  signed — never use it as a global `fetch`, you'd leak the token. */
  origins?: string[];
  /** Refresh and retry once after a 401 from your API (default `true`). */
  retryOn401?: boolean;
  /** `fetch` to wrap (defaults to the global). */
  fetch?: FetchLike;
}

/** A `fetch` that signs requests with the session's access token, refreshing
 *  near expiry and retrying once on a 401.
 *  See docs/ARCHITECTURE/SESSION.md. */
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

    // Signing consumes a Request's body, so the retry needs its own copy.
    const replay = isRequest(input) ? input.clone() : null;

    const token = await tokenOrNull(session);
    const [firstInput, firstInit] = sign(input, init, token);
    const first = await base(firstInput, firstInit);

    if (first.status !== 401 || !retryOn401 || !token) return first;

    let fresh: string;
    try {
      fresh = (await session.refresh()).accessToken;
    } catch {
      // Masking the API's 401 with the refresh error hides why it failed.
      return first;
    }
    const [retryInput, retryInit] = sign(replay ?? input, init, fresh);
    return base(retryInput, retryInit);
  }) as FetchLike;
}

/** Token, or `null` when signed out. A 401 means "not signed in" (normal);
 *  anything else is a real failure and propagates. */
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
    // Relative URLs are same-origin by definition.
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
