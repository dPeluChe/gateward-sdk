// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  GatewardAuth,
  createWebStorage,
  withSessionMarker,
  type AuthStateChange,
  type TokenSet,
} from "../src/index.js";
import { stubFetch, fakeAccessToken } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";
const KEY = "gateward.tokens";

const future = () => Math.floor(Date.now() / 1000) + 900;

function tokens(refresh: string): TokenSet {
  return {
    accessToken: fakeAccessToken(future(), [refresh]),
    refreshToken: refresh,
    expiresAt: future(),
  };
}

/** jsdom here exposes no localStorage, and the SDK takes an explicit area. */
function memoryArea(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

/** jsdom's StorageEvent constructor rejects a non-jsdom `storageArea`, so
 *  build the event by hand. */
function storageEvent(fields: Partial<StorageEvent>): StorageEvent {
  return Object.assign(new Event("storage"), fields) as StorageEvent;
}

/** What another tab writing to the same area looks like to this one. */
function fromOtherTab(
  area: Storage,
  newValue: TokenSet | null,
  oldValue: TokenSet | null,
) {
  window.dispatchEvent(
    storageEvent({
      key: KEY,
      newValue: newValue ? JSON.stringify(newValue) : null,
      oldValue: oldValue ? JSON.stringify(oldValue) : null,
      storageArea: area,
    }),
  );
}

function session(opts: { syncTabs?: boolean } = {}) {
  const { fetch } = stubFetch([]);
  const area = memoryArea();
  const auth = new GatewardAuth({
    baseUrl: BASE,
    appId: APP,
    storage: createWebStorage(KEY, area),
    fetch,
    ...(opts.syncTabs === false ? { syncTabs: false } : {}),
  });
  const seen: AuthStateChange[] = [];
  auth.onAuthStateChange((c) => seen.push(c));
  return { auth, seen, area };
}

describe("cross-tab sync", () => {
  it("signs out when another tab clears the session", () => {
    const { seen, area } = session();

    fromOtherTab(area, null, tokens("r1"));

    expect(seen.map((c) => c.event)).toEqual(["signed_out"]);
    expect(seen[0]!.tokens).toBeNull();
  });

  it("signs in when another tab logs in", () => {
    const { seen, area } = session();

    fromOtherTab(area, tokens("r1"), null);

    expect(seen.map((c) => c.event)).toEqual(["signed_in"]);
  });

  it("reports another tab's refresh as token_refreshed, not a new sign-in", () => {
    const { seen, area } = session();

    fromOtherTab(area, tokens("r2"), tokens("r1"));

    expect(seen.map((c) => c.event)).toEqual(["token_refreshed"]);
  });

  it("ignores a rewrite of the same pair", () => {
    const { seen, area } = session();
    const same = tokens("r1");

    fromOtherTab(area, same, same);

    expect(seen).toEqual([]);
  });

  it("ignores unrelated keys and storage areas", () => {
    const { seen, area } = session();

    window.dispatchEvent(
      storageEvent({ key: "theme", newValue: "dark", storageArea: area }),
    );
    window.dispatchEvent(
      storageEvent({
        key: KEY,
        newValue: JSON.stringify(tokens("r1")),
        storageArea: memoryArea(),
      }),
    );

    expect(seen).toEqual([]);
  });

  it("stays quiet when syncTabs is off", () => {
    const { seen, area } = session({ syncTabs: false });

    fromOtherTab(area, null, tokens("r1"));

    expect(seen).toEqual([]);
  });

  it("stops after dispose", () => {
    const { auth, seen, area } = session();

    auth.dispose();
    fromOtherTab(area, null, tokens("r1"));

    expect(seen).toEqual([]);
  });

  /// Wrapping the storage must not silently drop sync — the marker cookie and
  /// tab sync are meant to be used together.
  it("survives being wrapped in withSessionMarker", () => {
    const { fetch } = stubFetch([]);
    const area = memoryArea();
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      storage: withSessionMarker(createWebStorage(KEY, area)),
      fetch,
    });
    const seen: AuthStateChange[] = [];
    auth.onAuthStateChange((c) => seen.push(c));

    fromOtherTab(area, null, tokens("r1"));

    expect(seen.map((c) => c.event)).toEqual(["signed_out"]);
  });

  it("drops the cached user so the next read refetches", async () => {
    const me = {
      json: {
        id: "u1",
        email: "b@app.com",
        account_status: "active",
        actor_kind: "human",
        created_at: "2026-08-01T00:00:00Z",
        ecosystem_id: "e1",
        identity_pool_id: "p1",
        app_id: APP,
        session_id: "s1",
        role: "member",
        metadata: {},
        scopes: [],
      },
    };
    const { fetch, calls } = stubFetch([
      { json: { access_token: fakeAccessToken(future()), refresh_token: "r1", token_type: "Bearer", expires_in: 900 } },
      me,
      me,
    ]);
    const area = memoryArea();
    const auth = new GatewardAuth({
      baseUrl: BASE,
      appId: APP,
      storage: createWebStorage(KEY, area),
      fetch,
    });
    await auth.login("a@app.com", "pw");
    await auth.getUser();

    fromOtherTab(area, tokens("r2"), null); // another tab signed a different user in
    await auth.getUser();

    expect(calls.filter((c) => c.url.endsWith("/v1/auth/me")).length).toBe(2);
  });
});
