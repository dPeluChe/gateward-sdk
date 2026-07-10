import { describe, it, expect, vi } from "vitest";
import { HttpClient, GatewardError } from "../src/index.js";
import { stubFetch } from "./helpers.js";

const BASE = "https://core.test";
// baseDelayMs: 0 keeps tests instant (no real backoff wait).
const RETRY = { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 };

describe("HttpClient retry (idempotency-aware)", () => {
  it("retries a 429 for any method (incl. POST) then succeeds", async () => {
    const { fetch, calls } = stubFetch([
      { status: 429, json: { error: "slow down" } },
      { json: { ok: true } },
    ]);
    const http = new HttpClient({ baseUrl: BASE, retry: RETRY, fetch });

    const out = await http.request("POST", "/v1/events", { body: {} });

    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("does NOT retry a POST on a network error (could double-run)", async () => {
    let hits = 0;
    const fetch = (async () => {
      hits++;
      throw new Error("ECONNRESET");
    }) as unknown as typeof globalThis.fetch;
    const http = new HttpClient({ baseUrl: BASE, retry: RETRY, fetch });

    await expect(http.request("POST", "/v1/events", { body: {} })).rejects.toMatchObject({
      status: 0,
    });
    expect(hits).toBe(1);
  });

  it("retries a GET on a network error (idempotent)", async () => {
    let hits = 0;
    const fetch = (async () => {
      hits++;
      if (hits < 2) throw new Error("ECONNRESET");
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    const http = new HttpClient({ baseUrl: BASE, retry: RETRY, fetch });

    const out = await http.request("GET", "/v1/admin/users");

    expect(out).toEqual([{ id: 1 }]);
    expect(hits).toBe(2);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const { fetch, calls } = stubFetch([
      { status: 429, json: { error: "1" } },
      { status: 429, json: { error: "2" } },
      { status: 429, json: { error: "3" } },
    ]);
    const http = new HttpClient({ baseUrl: BASE, retry: RETRY, fetch });

    await expect(http.request("POST", "/x", { body: {} })).rejects.toMatchObject({
      status: 429,
    });
    expect(calls).toHaveLength(3); // 1 initial + 2 retries
  });

  it("does not retry when retry is disabled (default)", async () => {
    const { fetch, calls } = stubFetch([{ status: 429, json: { error: "x" } }]);
    const http = new HttpClient({ baseUrl: BASE, fetch });

    await expect(http.request("GET", "/x")).rejects.toBeInstanceOf(GatewardError);
    expect(calls).toHaveLength(1);
  });

  it("does not retry a plain 500 (may have executed)", async () => {
    const { fetch, calls } = stubFetch([{ status: 500, json: { error: "boom" } }]);
    const http = new HttpClient({ baseUrl: BASE, retry: RETRY, fetch });

    await expect(http.request("POST", "/x", { body: {} })).rejects.toMatchObject({
      status: 500,
    });
    expect(calls).toHaveLength(1);
  });

  it("fires onRetry with attempt + status", async () => {
    const onRetry = vi.fn();
    const { fetch } = stubFetch([{ status: 429, json: {} }, { json: {} }]);
    const http = new HttpClient({
      baseUrl: BASE,
      retry: RETRY,
      hooks: { onRetry },
      fetch,
    });

    await http.request("GET", "/x");

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, status: 429, path: "/x" }),
    );
  });
});
