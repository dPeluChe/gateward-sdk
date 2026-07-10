import { describe, it, expect, vi } from "vitest";
import { GatewardAuth, GatewardPlatform } from "../src/index.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-1";
const future = () => Math.floor(Date.now() / 1000) + 900;

function token(): StubResponse {
  return {
    json: {
      access_token: fakeAccessToken(future()),
      refresh_token: "r",
      token_type: "Bearer",
      expires_in: 900,
    },
  };
}

async function loggedInPlatform(extra: StubResponse[]) {
  const { fetch, calls } = stubFetch([token(), ...extra]);
  const p = new GatewardPlatform({ baseUrl: BASE, fetch });
  await p.platformLogin("admin@x.co", "pw");
  return { p, calls };
}

describe("GatewardPlatform typed resources", () => {
  it("users.list hits /v1/admin/users with query", async () => {
    const { p, calls } = await loggedInPlatform([{ json: [{ id: "u1" }] }]);
    const users = await p.users.list({ ecosystem_id: "eco-1", limit: 25 });
    expect(users).toEqual([{ id: "u1" }]);
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe("/v1/admin/users");
    expect(url.searchParams.get("ecosystem_id")).toBe("eco-1");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("users.updateStatus PATCHes the user", async () => {
    const { p, calls } = await loggedInPlatform([{ json: { id: "u1" } }]);
    await p.users.updateStatus("u1", { account_status: "blocked" });
    expect(calls[1]!.method).toBe("PATCH");
    expect(calls[1]!.url).toBe(`${BASE}/v1/admin/users/u1`);
    expect(calls[1]!.body).toEqual({ account_status: "blocked" });
  });

  it("apiKeys.create POSTs and returns the one-time key", async () => {
    const { p, calls } = await loggedInPlatform([
      { json: { id: "k1", key: "gw_sk_x", created_at: "now" } },
    ]);
    const res = await p.apiKeys.create({
      ecosystem_id: "e",
      identity_pool_id: "p",
      email: "svc@x",
      scopes: ["events:write"],
    });
    expect(res.key).toBe("gw_sk_x");
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toBe(`${BASE}/v1/admin/api-keys`);
  });

  it("sessions.revoke DELETEs the admin session", async () => {
    const { p, calls } = await loggedInPlatform([{ status: 204 }]);
    await p.sessions.revoke("s1");
    expect(calls[1]!.method).toBe("DELETE");
    expect(calls[1]!.url).toBe(`${BASE}/v1/admin/sessions/s1`);
  });

  it("events.list hits /v1/admin/events", async () => {
    const { p, calls } = await loggedInPlatform([{ json: [] }]);
    await p.events.list({ event_type: "login_succeeded" });
    const url = new URL(calls[1]!.url);
    expect(url.pathname).toBe("/v1/admin/events");
    expect(url.searchParams.get("event_type")).toBe("login_succeeded");
  });
});

describe("observability hooks", () => {
  it("fires onRequest + onResponse on success", async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const { fetch } = stubFetch([token()]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      hooks: { onRequest, onResponse },
      fetch,
    });
    await auth.login("a@b.co", "pw");
    expect(onRequest).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/auth/login",
    });
    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v1/auth/login", status: 200 }),
    );
  });

  it("fires onError on a non-2xx", async () => {
    const onError = vi.fn();
    const { fetch } = stubFetch([{ status: 401, json: { error: "nope" } }]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      hooks: { onError },
      fetch,
    });
    await expect(auth.login("a@b.co", "pw")).rejects.toBeDefined();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v1/auth/login" }),
    );
    expect(onError.mock.calls[0]![0].error.status).toBe(401);
  });
});

describe("auth recovery endpoints", () => {
  it("forgotPassword posts to the right path with app-id", async () => {
    const { fetch, calls } = stubFetch([{ json: { message: "ok" } }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.forgotPassword("a@b.co");
    expect(calls[0]!.url).toBe(`${BASE}/v1/auth/forgot-password`);
    expect(calls[0]!.headers["x-gateward-app-id"]).toBe(APP);
    expect(calls[0]!.body).toEqual({ email: "a@b.co" });
  });

  it("resetPassword sends token + new_password", async () => {
    const { fetch, calls } = stubFetch([{ status: 204 }]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.resetPassword("tok-1", "newpass123");
    expect(calls[0]!.url).toBe(`${BASE}/v1/auth/reset-password`);
    expect(calls[0]!.body).toEqual({ token: "tok-1", new_password: "newpass123" });
  });
});
