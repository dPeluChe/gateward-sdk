import { describe, it, expect } from "vitest";
import { GatewardAuth } from "../src/index.js";
import { GatewardServer } from "../src/server.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";
const KEY = "gw_test_key";

const future = () => Math.floor(Date.now() / 1000) + 900;

const tokenResponse = (): StubResponse => ({
  json: {
    access_token: fakeAccessToken(future()),
    refresh_token: "refresh-1",
    token_type: "Bearer",
    expires_in: 900,
  },
});

const member = (userId: string, role = "member"): StubResponse["json"] => ({
  user_id: userId,
  app_id: APP,
  email: `${userId}@app.com`,
  role,
  status: "active",
  local_metadata: { display_name: "Ana" },
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
});

const meResponse = (userId = "user-1"): StubResponse => ({
  json: {
    user_id: userId,
    email: `${userId}@app.com`,
    email_verified: true,
    account_status: "active",
    actor_kind: "human",
    app_id: APP,
    membership_role: "app_admin",
    scopes: ["app:user_manage"],
    metadata: {},
    created_at: "2026-08-01T00:00:00Z",
  },
});

describe("GatewardServer members", () => {
  it("lists members with the API key and surfaces X-Total-Count", async () => {
    const { fetch, calls } = stubFetch([
      { json: [member("user-1"), member("user-2")], headers: { "x-total-count": "42" } },
    ]);
    const gw = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    const page = await gw.listMembers(APP, { limit: 2 });

    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/${APP}/members?limit=2`);
    expect(calls[0]!.headers["x-api-key"]).toBe(KEY);
    expect(page.members).toHaveLength(2);
    expect(page.total).toBe(42);
  });

  it("leaves total undefined when the header is absent", async () => {
    const { fetch } = stubFetch([{ json: [member("user-1")] }]);
    const gw = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    expect((await gw.listMembers(APP)).total).toBeUndefined();
  });

  it("reads one membership", async () => {
    const { fetch, calls } = stubFetch([{ json: member("user-9") }]);
    const gw = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    const m = await gw.getMember(APP, "user-9");

    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/${APP}/members/user-9`);
    expect(m.user_id).toBe("user-9");
    expect(m.local_metadata).toEqual({ display_name: "Ana" });
  });

  it("promotes a member", async () => {
    const { fetch, calls } = stubFetch([{ json: member("user-9", "app_admin") }]);
    const gw = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    const m = await gw.setMemberRole(APP, "user-9", "app_admin");

    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ role: "app_admin" });
    expect(m.role).toBe("app_admin");
  });

  /// The Core keeps at least one app_admin per app; the SDK must surface that
  /// 409 rather than swallow it.
  it("propagates the last-admin 409", async () => {
    const { fetch } = stubFetch([
      { status: 409, json: { error: "cannot demote the last app_admin" } },
    ]);
    const gw = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    await expect(gw.setMemberRole(APP, "user-9", "member")).rejects.toThrow(
      /409/,
    );
  });
});

describe("GatewardAuth members", () => {
  it("scopes calls to the client's own app", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(),
      { json: [member("user-1")] },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("admin@app.com", "pw");

    await auth.listMembers();

    expect(calls[1]!.url).toBe(`${BASE}/v1/apps/${APP}/members`);
    expect(calls[1]!.headers["authorization"]).toMatch(/^Bearer /);
  });

  /// Scopes are only re-derived at refresh, so changing your own role would
  /// otherwise leave the UI gating on stale permissions for up to 15 minutes.
  it("forces a refresh after changing your own role", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(),
      { json: member("user-1", "app_admin") }, // PATCH
      meResponse("user-1"), // getUser to compare ids
      tokenResponse(), // forced refresh
      meResponse("user-1"), // re-read with new scopes
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("admin@app.com", "pw");

    await auth.setMemberRole("user-1", "app_admin");

    expect(calls.map((c) => c.url)).toContain(`${BASE}/v1/auth/refresh`);
  });

  it("does not refresh when changing someone else's role", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(),
      { json: member("user-2", "app_admin") },
      meResponse("user-1"),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("admin@app.com", "pw");

    await auth.setMemberRole("user-2", "app_admin");

    expect(calls.map((c) => c.url)).not.toContain(`${BASE}/v1/auth/refresh`);
  });
});
