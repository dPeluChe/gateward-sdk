import { describe, it, expect } from "vitest";
import { GatewardAuth } from "../src/index.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";
const API = "https://api.myapp.com";

const future = () => Math.floor(Date.now() / 1000) + 900;

/** `tag` lands in the token payload so a retry's bearer is distinguishable
 *  from the first attempt's. */
function tokenResponse(tag = "1"): StubResponse {
  return {
    json: {
      access_token: fakeAccessToken(future(), [tag]),
      refresh_token: `refresh-${tag}`,
      token_type: "Bearer",
      expires_in: 900,
    },
  };
}

const bearerOf = (headers: Record<string, string>) =>
  headers["authorization"];

describe("createFetch", () => {
  it("attaches the bearer to your own API", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(), { json: { ok: 1 } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const apiFetch = auth.createFetch({ fetch });
    const res = await apiFetch(`${API}/orders`);

    expect(res.status).toBe(200);
    expect(calls[1]!.url).toBe(`${API}/orders`);
    expect(bearerOf(calls[1]!.headers)).toMatch(/^Bearer /);
  });

  it("preserves the caller's own headers and method", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(), { json: { ok: 1 } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    await auth.createFetch({ fetch })(`${API}/orders`, {
      method: "POST",
      headers: { "x-trace": "abc", "content-type": "application/json" },
      body: JSON.stringify({ total: 42 }),
    });

    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.headers["x-trace"]).toBe("abc");
    expect(calls[1]!.body).toEqual({ total: 42 });
    expect(bearerOf(calls[1]!.headers)).toMatch(/^Bearer /);
  });

  /// Signed out is a normal state, not an error: the request still goes out
  /// so public endpoints work and your API answers with its own 401.
  it("passes the request through unsigned when there is no session", async () => {
    const { fetch, calls } = stubFetch([{ json: { ok: 1 } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    const res = await auth.createFetch({ fetch })(`${API}/public`);

    expect(res.status).toBe(200);
    expect(bearerOf(calls[0]!.headers)).toBeUndefined();
  });

  it("refreshes and retries once on a 401 from your API", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse("first"),
      { status: 401, json: { error: "expired" } },
      tokenResponse("second"),
      { json: { ok: 1 } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const res = await auth.createFetch({ fetch })(`${API}/orders`);

    expect(res.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/v1/auth/login`,
      `${API}/orders`,
      `${BASE}/v1/auth/refresh`,
      `${API}/orders`,
    ]);
    // The retry carries a different token than the first attempt.
    expect(bearerOf(calls[3]!.headers)).not.toBe(bearerOf(calls[1]!.headers));
  });

  it("retries at most once", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse("first"),
      { status: 401, json: { error: "expired" } },
      tokenResponse("second"),
      { status: 401, json: { error: "still no" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const res = await auth.createFetch({ fetch })(`${API}/orders`);

    expect(res.status).toBe(401);
    expect(calls.length).toBe(4);
  });

  /// Masking the API's 401 with a refresh error would hide the real reason
  /// the call failed.
  it("returns the original 401 when the refresh itself fails", async () => {
    const { fetch } = stubFetch([
      tokenResponse(),
      { status: 401, json: { error: "expired" } },
      { status: 401, json: { error: "dead refresh token" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const res = await auth.createFetch({ fetch })(`${API}/orders`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  it("does not retry when retryOn401 is off", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(),
      { status: 401, json: { error: "expired" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const res = await auth
      .createFetch({ fetch, retryOn401: false })(`${API}/orders`);

    expect(res.status).toBe(401);
    expect(calls.length).toBe(2);
  });

  /// Handing your access token to a third party is the failure mode worth
  /// guarding: an allowlist keeps it on your own API.
  it("only signs allowlisted origins", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(),
      { json: { ok: 1 } },
      { json: { ok: 1 } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const apiFetch = auth.createFetch({ fetch, origins: [API] });
    await apiFetch(`${API}/orders`);
    await apiFetch("https://analytics.vendor.com/collect");

    expect(bearerOf(calls[1]!.headers)).toMatch(/^Bearer /);
    expect(bearerOf(calls[2]!.headers)).toBeUndefined();
  });

  it("accepts an origin written with a path or trailing slash", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(), { json: { ok: 1 } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    await auth.createFetch({ fetch, origins: [`${API}/v1/`] })(`${API}/orders`);

    expect(bearerOf(calls[1]!.headers)).toMatch(/^Bearer /);
  });

  it("signs a Request object and can still replay it on a 401", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse("first"),
      { status: 401, json: { error: "expired" } },
      tokenResponse("second"),
      { json: { ok: 1 } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const req = new Request(`${API}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trace": "abc" },
      body: JSON.stringify({ total: 42 }),
    });
    const res = await auth.createFetch({ fetch })(req);

    expect(res.status).toBe(200);
    expect(calls[3]!.method).toBe("POST");
    expect(calls[3]!.headers["x-trace"]).toBe("abc");
    expect(calls[3]!.body).toEqual({ total: 42 });
  });
});
