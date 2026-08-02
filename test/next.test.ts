import { describe, it, expect } from "vitest";
import {
  SESSION_MARKER_COOKIE,
  createGatewardMiddleware,
  hasSessionMarker,
} from "../src/next.js";

const SITE = "https://app.test";

/** The shape Next's `NextRequest` and a plain `Request` both satisfy. */
function req(path: string, cookie?: string) {
  return {
    url: `${SITE}${path}`,
    headers: { get: (name: string) => (name === "cookie" ? (cookie ?? null) : null) },
  };
}

const signedIn = `${SESSION_MARKER_COOKIE}=1`;

describe("hasSessionMarker", () => {
  it("finds the marker among other cookies", () => {
    expect(hasSessionMarker(`theme=dark; ${signedIn}; locale=es`)).toBe(true);
  });

  it("is false with no cookie header at all", () => {
    expect(hasSessionMarker(null)).toBe(false);
    expect(hasSessionMarker(undefined)).toBe(false);
    expect(hasSessionMarker("")).toBe(false);
  });

  /// Clearing writes the name with an empty value; treating that as signed in
  /// would strand a logged-out user on a shell that can't load anything.
  it("is false for a cleared marker", () => {
    expect(hasSessionMarker(`${SESSION_MARKER_COOKIE}=`)).toBe(false);
  });

  it("does not match a cookie that merely shares a prefix", () => {
    expect(hasSessionMarker("gateward.authed_other=1")).toBe(false);
  });

  it("honors a custom cookie name", () => {
    expect(hasSessionMarker("myapp.authed=1", "myapp.authed")).toBe(true);
    expect(hasSessionMarker("myapp.authed=1")).toBe(false);
  });
});

describe("createGatewardMiddleware", () => {
  const mw = createGatewardMiddleware({
    protect: ["/dashboard", "/settings"],
    authenticatedHome: "/dashboard",
  });

  it("lets a signed-out visitor through on a public path", () => {
    expect(mw(req("/"))).toBeUndefined();
    expect(mw(req("/pricing"))).toBeUndefined();
  });

  it("redirects a signed-out visitor off a protected path", () => {
    const res = mw(req("/dashboard/orders"));

    expect(res?.status).toBe(307);
    const location = new URL(res!.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard/orders");
  });

  it("keeps the query string in the return path", () => {
    const res = mw(req("/dashboard?tab=open"));
    const location = new URL(res!.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/dashboard?tab=open");
  });

  it("lets a signed-in visitor into a protected path", () => {
    expect(mw(req("/dashboard/orders", signedIn))).toBeUndefined();
  });

  it("bounces a signed-in visitor off the login screen", () => {
    const res = mw(req("/login", signedIn));

    expect(res?.status).toBe(307);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("leaves a signed-out visitor on the login screen", () => {
    expect(mw(req("/login"))).toBeUndefined();
  });

  /// A prefix must not leak into a sibling route that merely starts the same.
  it("matches path segments, not raw prefixes", () => {
    expect(mw(req("/dashboard-public"))).toBeUndefined();
    expect(mw(req("/dashboard"))).not.toBeUndefined();
    expect(mw(req("/dashboard/"))).not.toBeUndefined();
  });

  it("accepts a predicate instead of a prefix list", () => {
    const custom = createGatewardMiddleware({
      protect: (p) => p.startsWith("/app") && !p.startsWith("/app/public"),
    });
    expect(custom(req("/app/secret"))).not.toBeUndefined();
    expect(custom(req("/app/public/x"))).toBeUndefined();
  });

  it("omits the return param when returnTo is false", () => {
    const bare = createGatewardMiddleware({
      protect: ["/dashboard"],
      returnTo: false,
    });
    const location = new URL(
      bare(req("/dashboard"))!.headers.get("location")!,
    );
    expect(location.search).toBe("");
  });

  /// The return path must stay same-origin, or the login page becomes an
  /// open redirect.
  it("never puts an absolute URL in the return param", () => {
    const res = mw(req("/dashboard//evil.com"));
    const next = new URL(res!.headers.get("location")!).searchParams.get(
      "next",
    );
    expect(next?.startsWith("/")).toBe(true);
    expect(next).not.toContain("://");
  });

  it("honors a custom login path and status", () => {
    const custom = createGatewardMiddleware({
      protect: ["/dashboard"],
      loginPath: "/auth/sign-in",
      status: 302,
    });
    const res = custom(req("/dashboard"));

    expect(res?.status).toBe(302);
    expect(new URL(res!.headers.get("location")!).pathname).toBe(
      "/auth/sign-in",
    );
  });

  it("does not bounce off the login screen without authenticatedHome", () => {
    const custom = createGatewardMiddleware({ protect: ["/dashboard"] });
    expect(custom(req("/login", signedIn))).toBeUndefined();
  });
});
