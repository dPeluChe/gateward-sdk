import { describe, it, expect } from "vitest";
import { GatewardAuth } from "../src/index.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";

function tokenResponse(exp: number, scopes: string[] = []): StubResponse {
  return {
    json: {
      access_token: fakeAccessToken(exp, scopes),
      refresh_token: `refresh-${exp}`,
      token_type: "Bearer",
      expires_in: 900,
    },
  };
}

const future = () => Math.floor(Date.now() / 1000) + 900;
const past = () => Math.floor(Date.now() / 1000) - 10;

describe("GatewardAuth", () => {
  it("login sends app-id header and persists tokens", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future())]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    const set = await auth.login("a@b.co", "pw");

    expect(calls[0]!.url).toBe(`${BASE}/v1/auth/login`);
    expect(calls[0]!.headers["x-gateward-app-id"]).toBe(APP);
    expect(calls[0]!.body).toEqual({ email: "a@b.co", password: "pw" });
    expect(set.accessToken).toContain(".");
    expect(await auth.getAccessToken()).toBe(set.accessToken);
  });

  it("sends an explicit device id as X-Gateward-Device-Id", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future())]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      deviceId: "dev-fixed-1",
      fetch,
    });

    await auth.login("a@b.co", "pw");

    expect(calls[0]!.headers["x-gateward-device-id"]).toBe("dev-fixed-1");
  });

  it("omits the device id header when disabled", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future())]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      deviceId: false,
      fetch,
    });

    await auth.login("a@b.co", "pw");

    expect(calls[0]!.headers["x-gateward-device-id"]).toBeUndefined();
  });

  it("getAccessToken refreshes when the token is near expiry", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(past()), // login → already-expired access token
      tokenResponse(future()), // refresh → fresh token
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    const loginSet = await auth.login("a@b.co", "pw");

    const token = await auth.getAccessToken();

    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/refresh`);
    expect(calls[1]!.body).toEqual({ refresh_token: `refresh-${past()}` });
    // Returned the freshly-refreshed token, not the expired login one.
    expect(token).not.toBe(loginSet.accessToken);
    expect(token).toBe(fakeAccessToken(future()));
  });

  it("coalesces concurrent refreshes into a single request", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(past()),
      tokenResponse(future()),
      tokenResponse(future()),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);

    const refreshCalls = calls.filter((c) => c.url.endsWith("/v1/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("authedRequest retries once after a 401 by refreshing", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      { status: 401, json: { error: "unauthorized" } }, // first GET rejected
      tokenResponse(future()), // refresh
      { json: [{ id: "s1" }] }, // retried GET
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    const sessions = await auth.listSessions();

    expect(sessions).toEqual([{ id: "s1" }]);
    expect(calls.map((c) => c.url)).toContain(`${BASE}/v1/auth/refresh`);
  });

  it("logout clears tokens even if the server call fails", async () => {
    const { fetch } = stubFetch([
      tokenResponse(future()),
      { status: 500, json: { error: "internal error" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    await auth.logout();

    await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 401 });
  });

  it("drops the session when refresh is rejected", async () => {
    const { fetch } = stubFetch([
      tokenResponse(past()),
      { status: 401, json: { error: "unauthorized" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("a@b.co", "pw");

    await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 401 });
    // Session cleared → a second call still fails, without another network hit.
    await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 401 });
  });
});
