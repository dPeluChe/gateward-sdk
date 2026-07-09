import { describe, it, expect } from "vitest";
import { GatewardPlatform } from "../src/index.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";

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
const future = () => Math.floor(Date.now() / 1000) + 900;
const past = () => Math.floor(Date.now() / 1000) - 10;

describe("GatewardPlatform", () => {
  it("platformLogin hits platform-login and sends NO app-id header", async () => {
    const { fetch, calls } = stubFetch([tokenResponse(future())]);
    const gw = new GatewardPlatform({ baseUrl: BASE, fetch });

    await gw.platformLogin("admin@x.co", "pw");

    expect(calls[0]!.url).toBe(`${BASE}/v1/auth/platform-login`);
    expect(calls[0]!.headers["x-gateward-app-id"]).toBeUndefined();
    expect(calls[0]!.body).toEqual({ email: "admin@x.co", password: "pw" });
  });

  it("authedRequest reaches admin endpoints with the bearer token", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(future()),
      { json: [{ id: "eco-1" }] },
    ]);
    const gw = new GatewardPlatform({ baseUrl: BASE, fetch });
    await gw.platformLogin("admin@x.co", "pw");

    const ecos = await gw.authedRequest("GET", "/v1/ecosystems");

    expect(ecos).toEqual([{ id: "eco-1" }]);
    expect(calls[1]!.url).toBe(`${BASE}/v1/ecosystems`);
    expect(calls[1]!.headers["authorization"]).toMatch(/^Bearer /);
    expect(calls[1]!.headers["x-gateward-app-id"]).toBeUndefined();
  });

  it("auto-refreshes an expiring platform token", async () => {
    const { fetch, calls } = stubFetch([
      tokenResponse(past()),
      tokenResponse(future()),
    ]);
    const gw = new GatewardPlatform({ baseUrl: BASE, fetch });
    await gw.platformLogin("admin@x.co", "pw");

    await gw.getAccessToken();

    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/refresh`);
  });
});
