import { describe, it, expect } from "vitest";
import {
  GatewardAuth,
  EnvironmentMismatchError,
  checkPassword,
  type PasswordPolicy,
} from "../src/index.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";

const future = () => Math.floor(Date.now() / 1000) + 900;

const tokenResponse = (): StubResponse => ({
  json: {
    access_token: fakeAccessToken(future()),
    refresh_token: "refresh-1",
    token_type: "Bearer",
    expires_in: 900,
  },
});

const appConfig = (
  environment = "test",
  password_policy: PasswordPolicy = { min_length: 8 },
): StubResponse => ({
  json: {
    app_id: APP,
    name: "Demo (test)",
    environment,
    identity_mode: "isolated",
    require_email_verification: false,
    password_policy,
  },
});

describe("getAppConfig", () => {
  it("reads the public config without auth and caches it", async () => {
    const { fetch, calls } = stubFetch([appConfig()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    const a = await auth.getAppConfig();
    const b = await auth.getAppConfig();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/current`);
    expect(calls[0]!.headers["x-gateward-app-id"]).toBe(APP);
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(a.environment).toBe("test");
    expect(b).toBe(a);
  });

  it("coalesces concurrent reads", async () => {
    const { fetch, calls } = stubFetch([appConfig()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await Promise.all([auth.getAppConfig(), auth.getAppConfig()]);

    expect(calls).toHaveLength(1);
  });
});

describe("environment guard", () => {
  /// The whole point: a test build pointed at production must fail before it
  /// can create a real user.
  it("refuses to log in when the app is production", async () => {
    const { fetch, calls } = stubFetch([appConfig("production")]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      expectEnvironment: "test",
      fetch,
    });

    await expect(auth.login("qa@app.com", "pw")).rejects.toThrow(
      EnvironmentMismatchError,
    );
    // Only the config read happened — no login was attempted.
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/apps/current`]);
  });

  it("refuses to register too", async () => {
    const { fetch, calls } = stubFetch([appConfig("production")]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      expectEnvironment: ["test", "development"],
      fetch,
    });

    await expect(auth.register("qa@app.com", "pw")).rejects.toThrow(
      /expects "test" or "development"/,
    );
    expect(calls).toHaveLength(1);
  });

  it("lets a matching environment through", async () => {
    const { fetch, calls } = stubFetch([appConfig("test"), tokenResponse()]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      expectEnvironment: "test",
      fetch,
    });

    await auth.login("qa@app.com", "pw");

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/v1/apps/current`,
      `${BASE}/v1/auth/login`,
    ]);
  });

  /// Apps that don't opt in must not pay an extra request per login.
  it("does not fetch the config when no environment is expected", async () => {
    const { fetch, calls } = stubFetch([tokenResponse()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    await auth.login("ana@app.com", "pw");

    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/auth/login`]);
  });

  it("ready() surfaces the mismatch at boot", async () => {
    const { fetch } = stubFetch([appConfig("staging")]);
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      expectEnvironment: "test",
      fetch,
    });

    await expect(auth.ready()).rejects.toThrow(EnvironmentMismatchError);
  });
});

describe("checkPassword", () => {
  it("passes an empty policy", () => {
    expect(checkPassword("x", {})).toEqual([]);
    expect(checkPassword("x", undefined)).toEqual([]);
  });

  it("checks length bounds", () => {
    expect(checkPassword("short", { min_length: 8 })).toEqual([
      "must be at least 8 characters",
    ]);
    expect(checkPassword("x".repeat(5), { max_length: 4 })).toEqual([
      "must be at most 4 characters",
    ]);
  });

  it("accepts a short numeric PIN when the policy asks for one", () => {
    const pin: PasswordPolicy = { min_length: 4, max_length: 4, numeric_only: true };
    expect(checkPassword("1234", pin)).toEqual([]);
    expect(checkPassword("12a4", pin)).toEqual(["must contain digits only"]);
  });

  /// numeric_only and the character-class flags can't both be satisfied, and
  /// the Core rejects the combination — advising both would be impossible.
  it("skips character-class rules under numeric_only", () => {
    expect(
      checkPassword("1234", { numeric_only: true, require_upper: true }),
    ).toEqual([]);
  });

  it("reports every failed rule at once", () => {
    expect(
      checkPassword("abc", {
        min_length: 8,
        require_digit: true,
        require_upper: true,
        require_symbol: true,
      }),
    ).toHaveLength(4);
  });

  it("validatePassword applies the app's own policy", async () => {
    const { fetch } = stubFetch([
      appConfig("test", { min_length: 4, max_length: 4, numeric_only: true }),
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    expect(await auth.validatePassword("1234")).toEqual([]);
    expect(await auth.validatePassword("correcthorse")).toEqual([
      "must be at most 4 characters",
      "must contain digits only",
    ]);
  });
});
