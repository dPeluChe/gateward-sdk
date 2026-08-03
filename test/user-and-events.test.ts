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
    user_id: "user-1",
    email,
    email_verified: true,
    account_status: "active",
    actor_kind: "human",
    app_id: APP,
    membership_role: "member",
    scopes: ["session:read_own", "users:write_own"],
    metadata: { display_name: "Ana" },
    created_at: "2026-08-01T00:00:00Z",
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
    expect(user.membership_role).toBe("member");
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

describe("self-service", () => {
  it("updateProfile merges metadata and refreshes the cache", async () => {
    const merged = meResponse();
    (merged.json as { metadata: Record<string, unknown> }).metadata = {
      display_name: "Ana Q",
    };
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      meResponse(),
      merged,
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    await auth.getUser();

    const updated = await auth.updateProfile({ display_name: "Ana Q" });

    expect(calls[2]!.method).toBe("PATCH");
    expect(calls[2]!.url).toBe(`${BASE}/v1/auth/me`);
    expect(calls[2]!.body).toEqual({ metadata: { display_name: "Ana Q" } });
    expect(updated.metadata).toEqual({ display_name: "Ana Q" });
    // Cached, so no extra /me round-trip.
    expect((await auth.getUser()).metadata).toEqual({ display_name: "Ana Q" });
    expect(calls.length).toBe(3);
  });

  it("changePassword sends both passwords", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future()), { status: 204 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await auth.changePassword("old-secret-1", "new-secret-2");

    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/change-password`);
    expect(calls[1]!.body).toEqual({
      current_password: "old-secret-1",
      new_password: "new-secret-2",
    });
  });

  it("revokeAllSessions keeps the current session by default", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      { json: { revoked: 3 } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    const revoked = await auth.revokeAllSessions();

    expect(revoked).toBe(3);
    expect(calls[1]!.url).toBe(`${BASE}/v1/sessions`);
    expect(calls[1]!.method).toBe("DELETE");
    // Still signed in locally.
    expect(await auth.getAccessToken()).toContain(".");
  });

  /// Revoking our own session leaves the stored tokens dead, so the local
  /// session has to go too or the app keeps rendering as signed in.
  it("revokeAllSessions with includeCurrent drops the local session", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      { json: { revoked: 4 } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    const seen: AuthStateChange[] = [];
    auth.onAuthStateChange((c) => seen.push(c));

    await auth.revokeAllSessions({ includeCurrent: true });

    expect(calls[1]!.url).toBe(`${BASE}/v1/sessions?include_current=true`);
    expect(seen.map((c) => c.event)).toEqual(["signed_out"]);
    await expect(auth.getAccessToken()).rejects.toThrow();
  });

  it("register carries the signup profile as metadata", async () => {
    const { fetch, calls } = stubFetch([{ status: 202, json: { message: "ok" } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.register("ana@app.com", "correcthorse123", {
      metadata: { display_name: "Ana", phone: "+52" },
    });

    expect(calls[0]!.body).toEqual({
      email: "ana@app.com",
      password: "correcthorse123",
      metadata: { display_name: "Ana", phone: "+52" },
    });
  });

  it("register sends only the credentials", async () => {
    const { fetch, calls } = stubFetch([{ status: 202, json: { message: "ok" } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.register("ana@app.com", "correcthorse123");

    expect(calls[0]!.body).toEqual({
      email: "ana@app.com",
      password: "correcthorse123",
    });
  });

  /// APP-POLICY-001: an app with require_email_verification=false gets tokens
  /// back from register. Dropping them would strand a user the Core already
  /// considers signed in.
  it("register signs in when the app returns tokens", async () => {
    const { fetch } = stubFetch([
      {
        status: 202,
        json: {
          message: "registered",
          access_token: fakeAccessToken(future()),
          refresh_token: "refresh-reg",
          token_type: "Bearer",
          expires_in: 900,
        },
      },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    const seen: AuthStateChange[] = [];
    auth.onAuthStateChange((c) => seen.push(c));

    await auth.register("ana@app.com", "correcthorse123");

    expect(seen.map((c) => c.event)).toEqual(["signed_in"]);
    expect(await auth.getAccessToken()).toContain(".");
  });

  it("register leaves no session when the app requires verification", async () => {
    const { fetch } = stubFetch([{ status: 202, json: { message: "check your inbox" } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    const seen: AuthStateChange[] = [];
    auth.onAuthStateChange((c) => seen.push(c));

    await auth.register("ana@app.com", "correcthorse123");

    expect(seen).toEqual([]);
    await expect(auth.getAccessToken()).rejects.toThrow();
  });

  /// A half-filled response (tokens missing expires_in) must not be treated
  /// as a session — persisting it would produce a token with no known expiry.
  it("register ignores an incomplete token pair", async () => {
    const { fetch } = stubFetch([
      {
        status: 202,
        json: {
          message: "registered",
          access_token: fakeAccessToken(future()),
          refresh_token: null,
        },
      },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.register("ana@app.com", "correcthorse123");

    await expect(auth.getAccessToken()).rejects.toThrow();
  });
});

describe("account lifecycle", () => {
  it("changeEmail sends the new address and password", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future()), { status: 202 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await auth.changeEmail("nueva@app.com", "pw");

    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/change-email`);
    expect(calls[1]!.body).toEqual({ new_email: "nueva@app.com", password: "pw" });
  });

  it("omits the password when the account has none", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future()), { status: 202 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await auth.changeEmail("nueva@app.com");

    expect(calls[1]!.body).toEqual({ new_email: "nueva@app.com" });
  });

  /// Confirming revokes every session in the pool, so the stored tokens are
  /// already dead — keeping them would leave the UI signed in over nothing.
  it("verifyEmailChange clears the local session", async () => {
    const { fetch } = stubFetch([tokenResponse(future()), { status: 204 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    const seen: AuthStateChange[] = [];
    auth.onAuthStateChange((c) => seen.push(c));

    await auth.verifyEmailChange("tok-123");

    expect(seen.map((c) => c.event)).toEqual(["signed_out"]);
    await expect(auth.getAccessToken()).rejects.toThrow();
  });

  it("keeps the session when the confirmation token is rejected", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      { status: 400, json: { error: "invalid or expired token" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await expect(auth.verifyEmailChange("bad")).rejects.toThrow();

    expect(await auth.getAccessToken()).toContain(".");
  });

  it("deleteAccount sends the password and drops the session", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future()), { status: 204 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");
    const seen: AuthStateChange[] = [];
    auth.onAuthStateChange((c) => seen.push(c));

    await auth.deleteAccount("pw");

    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/delete-account`);
    expect(calls[1]!.body).toEqual({ password: "pw" });
    expect(seen.map((c) => c.event)).toEqual(["signed_out"]);
  });

  /// A wrong password answers 401 — the same code as an expired token. If the
  /// SDK retried, it would burn a refresh and replay the attempt against the
  /// rate limit without ever being able to tell the two apart.
  it("does not refresh-and-retry when the password is wrong", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      { status: 401, json: { error: "wrong password" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await expect(auth.deleteAccount("wrong")).rejects.toThrow(/401/);

    // login + the single delete attempt: no refresh, no replay.
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/v1/auth/login`,
      `${BASE}/v1/auth/delete-account`,
    ]);
    expect(await auth.getAccessToken()).toContain(".");
  });

  it("does not retry changeEmail or changePassword on a 401 either", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      { status: 401, json: { error: "wrong password" } },
      { status: 401, json: { error: "wrong password" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    await expect(auth.changeEmail("x@app.com", "wrong")).rejects.toThrow(/401/);
    await expect(auth.changePassword("wrong", "otra-larga")).rejects.toThrow(/401/);

    expect(calls.filter((c) => c.url.endsWith("/v1/auth/refresh"))).toHaveLength(0);
  });
});
