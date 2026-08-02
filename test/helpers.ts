import type { FetchLike } from "../src/index.js";

export interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status?: number;
  json?: unknown;
  text?: string;
}

/** A `fetch` stub that records calls and replays queued responses in order.
 *  A response can also be a function of the call for dynamic behavior. */
export function stubFetch(
  responses: Array<StubResponse | ((call: StubCall) => StubResponse)>,
): { fetch: FetchLike; calls: StubCall[] } {
  const calls: StubCall[] = [];
  let i = 0;
  // Normalize through `Request` exactly as a real fetch does, so callers can
  // pass a Request, a `Headers` instance, or a plain object and the recorded
  // call looks the same either way.
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const raw = await req.text();
    const call: StubCall = {
      url: req.url,
      method: req.method,
      headers,
      body: raw ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    const spec = responses[i++] ?? {};
    const r = typeof spec === "function" ? spec(call) : spec;
    const status = r.status ?? 200;
    const payload =
      r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
    // 204/205/304 must have a null body, and an empty string is still a body.
    const body = payload === "" ? null : payload;
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as FetchLike;
  return { fetch, calls };
}

/** Base64url-encode a JSON object into a fake (unsigned) JWT segment. */
function seg(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A structurally-valid but UNSIGNED JWT with the given `exp` (unix secs)
 *  and scopes — enough for decode-based refresh scheduling in tests. */
export function fakeAccessToken(exp: number, scopes: string[] = []): string {
  return `${seg({ alg: "ES256" })}.${seg({ exp, scopes })}.sig`;
}
