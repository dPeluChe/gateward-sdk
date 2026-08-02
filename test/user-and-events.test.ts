import { describe, it, expect } from "vitest";
import { GatewardAuth, type AuthStateChange } from "../src/index.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";

function tokenResponse(exp: number): StubResponse {
  return {
    json: {
      access_token: fakeAccessToken(exp),
      refresh_token: `refresh-${exp}`,
      token_type: "Bearer",
      expires_in: 900,
    },
  };
}

const meResponse = (email = "ana@app.com"): StubResponse => ({
  json: {
    id: "user-1",
    email,
    account_status: "active",
    actor_kind: "human",
    created_at: "2026-08-01T00:00:00Z",
    ecosystem_id: "eco-1",
    identity_pool_id: "pool-1",
    app_id: APP,
    session_id: "sess-1",
    role: "member",
    metadata: { display_name: "Ana" },
    scopes: ["session:read_own"],
  },
});

const future = () => Math.floor(Date.now() / 1000) + 900;

describe("getUser", () => {
  it("fetches /v1/auth/me with the bearer and returns the identity", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      meResponse(),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    const user = await auth.getUser();

    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/me`);
    expect(calls[1]!.headers["authorization"]).toMatch(/^Bearer /);
    expect(user.email).toBe("ana@app.com");
    expect(user.role).toBe("member");
    expect(user.metadata).toEqual({ display_name: "Ana" });
  });

  it("caches the identity and re-fetches only when forced", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      meResponse(),
      meResponse("renamed@app.com"),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await auth.getUser();
    await auth.getUser();
    expect(calls.length).toBe(2); // login + one /me

    const forced = await auth.getUser({ force: true });
    expect(calls.length).toBe(3);
    expect(forced.email).toBe("renamed@app.com");
  });

  it("coalesces concurrent calls onto one request", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future()), meResponse()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    const [a, b] = await Promise.all([auth.getUser(), auth.getUser()]);

    expect(calls.length).toBe(2);
    expect(a).toBe(b);
  });

  it("drops the cached identity on a new login (different user)", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      meResponse("first@app.com"),
      tokenResponse(future()),
      meResponse("second@app.com"),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.login("first@app.com", "pw");
    expect((await auth.getUser()).email).toBe("first@app.com");

    await auth.login("second@app.com", "pw");
    expect((await auth.getUser()).email).toBe("second@app.com");
  });

  it("keeps the cached identity across a token refresh", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      meResponse(),
      tokenResponse(future()), // the explicit refresh below
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await auth.getUser();
    await auth.refresh();
    await auth.getUser();

    expect(calls.filter((c) => c.url.endsWith("/v1/auth/me")).length).toBe(1);
  });
});

describe("getClaims", () => {
  it("decodes the current access token without a round-trip", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future())]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    const claims = await auth.getClaims();

    expect(calls.length).toBe(1);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe("onAuthStateChange", () => {
  function recorder(auth: GatewardAuth) {
    const seen: AuthStateChange[] = [];
    const off = auth.onAuthStateChange((c) => seen.push(c));
    return { seen, off };
  }

  it("emits signed_in on login and signed_out on logout", async () => {
    const { fetch } = stubFetch([tokenResponse(future()), { status: 204 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    const { seen } = recorder(auth);

    await auth.login("ana@app.com", "pw");
    await auth.logout();

    expect(seen.map((c) => c.event)).toEqual(["signed_in", "signed_out"]);
    expect(seen[0]!.tokens).not.toBeNull();
    expect(seen[1]!.tokens).toBeNull();
  });

  it("emits token_refreshed when the pair rotates", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      tokenResponse(future()),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    const { seen } = recorder(auth);

    await auth.refresh();

    expect(seen.map((c) => c.event)).toEqual(["token_refreshed"]);
  });

  /// The gap this closes: before, a dead refresh token cleared storage in
  /// silence and the app kept rendering an authenticated shell.
  it("emits session_expired when the refresh token is rejected", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      { status: 401, json: { error: "invalid refresh token" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    const { seen } = recorder(auth);

    await expect(auth.refresh()).rejects.toThrow();

    expect(seen.map((c) => c.event)).toEqual(["session_expired"]);
    expect(seen[0]!.tokens).toBeNull();
    await expect(auth.getAccessToken()).rejects.toThrow();
  });

  it("does not emit session_expired for a non-401 refresh failure", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      { status: 500, json: { error: "boom" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    const { seen } = recorder(auth);

    await expect(auth.refresh()).rejects.toThrow();

    expect(seen).toEqual([]); // the session may still be good — don't tear it down
  });

  it("stops delivering after unsubscribe", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      tokenResponse(future()),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    const { seen, off } = recorder(auth);

    await auth.login("ana@app.com", "pw");
    off();
    await auth.refresh();

    expect(seen.map((c) => c.event)).toEqual(["signed_in"]);
  });

  it("isolates a throwing listener from the session", async () => {
    const { fetch } = stubFetch([tokenResponse(future())]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    const seen: string[] = [];
    auth.onAuthStateChange(() => {
      throw new Error("subscriber blew up");
    });
    auth.onAuthStateChange((c) => seen.push(c.event));

    const set = await auth.login("ana@app.com", "pw");

    expect(set.accessToken).toContain(".");
    expect(seen).toEqual(["signed_in"]);
  });
});

describe("register", () => {
  it("sends the signup profile as metadata", async () => {
    const { fetch, calls } = stubFetch([{ status: 202, json: { message: "ok" } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.register("ana@app.com", "correcthorse123", {
      metadata: { display_name: "Ana", locale: "es-MX" },
    });

    expect(calls[0]!.body).toEqual({
      email: "ana@app.com",
      password: "correcthorse123",
      metadata: { display_name: "Ana", locale: "es-MX" },
    });
  });

  it("omits metadata entirely when not given", async () => {
    const { fetch, calls } = stubFetch([{ status: 202, json: { message: "ok" } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.register("ana@app.com", "correcthorse123");

    expect(calls[0]!.body).toEqual({
      email: "ana@app.com",
      password: "correcthorse123",
    });
  });
});
