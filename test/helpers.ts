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
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) {
      headers[k.toLowerCase()] = String(v);
    }
    const call: StubCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const spec = responses[i++] ?? {};
    const r = typeof spec === "function" ? spec(call) : spec;
    const status = r.status ?? 200;
    const payload =
      r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
    return new Response(payload, {
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
