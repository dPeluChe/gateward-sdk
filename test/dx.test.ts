import { describe, it, expect, vi } from "vitest";
import { GatewardAuth } from "../src/index.js";
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

describe("timezone header", () => {
  it("sends X-Gateward-Timezone from GatewardAuth", async () => {
    const { fetch, calls } = stubFetch([token()]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      timezone: "America/Argentina/Buenos_Aires",
      fetch,
    });
    await auth.login("a@b.co", "pw");
    expect(calls[0]!.headers["x-gateward-timezone"]).toBe(
      "America/Argentina/Buenos_Aires",
    );
  });

  it("omits the timezone header when disabled", async () => {
    const { fetch, calls } = stubFetch([token()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, timezone: false, fetch });
    await auth.login("a@b.co", "pw");
    expect(calls[0]!.headers["x-gateward-timezone"]).toBeUndefined();
  });
});
