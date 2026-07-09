import { describe, it, expect } from "vitest";
import { GatewardServer } from "../src/server.js";
import { stubFetch } from "./helpers.js";

const BASE = "https://core.test";
const KEY = "gw_test_key";

describe("GatewardServer", () => {
  it("sendEvent posts to /v1/events with the API key and namespaced type", async () => {
    const { fetch, calls } = stubFetch([{ status: 202 }]);
    const server = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    await server.sendEvent({
      eventType: "app.checkout.completed",
      metadata: { amount: 42 },
    });

    expect(calls[0]!.url).toBe(`${BASE}/v1/events`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["x-api-key"]).toBe(KEY);
    expect(calls[0]!.body).toEqual({
      event_type: "app.checkout.completed",
      metadata: { amount: 42 },
    });
  });

  it("listEvents drops undefined query params", async () => {
    const { fetch, calls } = stubFetch([{ json: [] }]);
    const server = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    await server.listEvents({ eventType: "app.x", limit: 10 });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/events");
    expect(url.searchParams.get("event_type")).toBe("app.x");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("user_id")).toBe(false);
  });

  it("surfaces a 429 as a GatewardError", async () => {
    const { fetch } = stubFetch([
      { status: 429, json: { error: "too many requests" } },
    ]);
    const server = new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch });

    await expect(
      server.sendEvent({ eventType: "app.x.y" }),
    ).rejects.toMatchObject({ status: 429, isRateLimited: true });
  });
});
