// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryStorage,
  SESSION_MARKER_COOKIE,
  hasSessionMarker,
  withSessionMarker,
} from "../src/index.js";
import type { TokenSet } from "../src/index.js";

const tokens: TokenSet = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Math.floor(Date.now() / 1000) + 900,
};

beforeEach(() => {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
});

describe("withSessionMarker", () => {
  it("sets the marker when tokens are stored", async () => {
    const storage = withSessionMarker(new MemoryStorage());

    await storage.set(tokens);

    expect(hasSessionMarker(document.cookie)).toBe(true);
  });

  it("clears the marker when the session is dropped", async () => {
    const storage = withSessionMarker(new MemoryStorage());
    await storage.set(tokens);

    await storage.clear();

    expect(hasSessionMarker(document.cookie)).toBe(false);
  });

  it("still delegates the tokens to the wrapped storage", async () => {
    const inner = new MemoryStorage();
    const storage = withSessionMarker(inner);

    await storage.set(tokens);
    expect(await storage.get()).toEqual(tokens);
    expect(inner.get()).toEqual(tokens);

    await storage.clear();
    expect(await storage.get()).toBeNull();
  });

  it("honors a custom cookie name", async () => {
    const storage = withSessionMarker(new MemoryStorage(), {
      name: "myapp.authed",
    });

    await storage.set(tokens);

    expect(hasSessionMarker(document.cookie, "myapp.authed")).toBe(true);
    expect(hasSessionMarker(document.cookie)).toBe(false);
  });

  /// The marker must never carry anything usable as a credential — it exists
  /// only so a server knows whether to render the authed layout.
  it("writes no token material into the cookie", async () => {
    const storage = withSessionMarker(new MemoryStorage());

    await storage.set(tokens);

    expect(document.cookie).not.toContain(tokens.accessToken);
    expect(document.cookie).not.toContain(tokens.refreshToken);
    expect(document.cookie).toContain(`${SESSION_MARKER_COOKIE}=1`);
  });
});
