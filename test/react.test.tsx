// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

import { GatewardAuth } from "../src/index.js";
import { GatewardProvider, useAuth } from "../src/react.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";

const future = () => Math.floor(Date.now() / 1000) + 900;

function tokenResponse(): StubResponse {
  return {
    json: {
      access_token: fakeAccessToken(future()),
      refresh_token: "refresh-1",
      token_type: "Bearer",
      expires_in: 900,
    },
  };
}

const meResponse = (email = "ana@app.com"): StubResponse => ({
  json: {
    user_id: "user-1",
    email,
    email_verified: true,
    account_status: "active",
    actor_kind: "human",
    app_id: APP,
    membership_role: "member",
    scopes: ["session:read_own", "users:write_own"],
    metadata: { display_name: "Ana" },
    created_at: "2026-08-01T00:00:00Z",
  },
});

const unauthorized: StubResponse = {
  status: 401,
  json: { error: "not authenticated" },
};

/** Renders the context so assertions read off the DOM, the way an app would. */
function Probe() {
  const { user, status, isAuthenticated, error } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="email">{user?.email ?? "-"}</span>
      <span data-testid="name">{String(user?.metadata?.display_name ?? "-")}</span>
      <span data-testid="error">{error?.message ?? "-"}</span>
    </div>
  );
}

function mount(auth: GatewardAuth, onSessionExpired?: () => void) {
  return render(
    <GatewardProvider
      auth={auth}
      {...(onSessionExpired ? { onSessionExpired } : {})}
    >
      <Probe />
    </GatewardProvider>,
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

afterEach(cleanup);

describe("GatewardProvider", () => {
  it("starts in loading and resolves to authenticated when a session exists", async () => {
    const { fetch } = stubFetch([tokenResponse(), meResponse()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    mount(auth);
    expect(text("status")).toBe("loading");

    await waitFor(() => expect(text("status")).toBe("authenticated"));
    expect(text("authed")).toBe("true");
    expect(text("email")).toBe("ana@app.com");
    expect(text("name")).toBe("Ana");
  });

  /// A 401 at bootstrap is the ordinary signed-out path — it must not surface
  /// as an error the app might show to a visitor who simply isn't logged in.
  it("resolves to unauthenticated without an error when there is no session", async () => {
    const { fetch } = stubFetch([]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    mount(auth);

    await waitFor(() => expect(text("status")).toBe("unauthenticated"));
    expect(text("error")).toBe("-");
  });

  /// The dangerous case: a 500 or a network blip must not be reported as
  /// "signed out", or the app bounces a perfectly valid session to /login.
  it("records the error when bootstrap fails for a non-401 reason", async () => {
    const { fetch } = stubFetch([
      tokenResponse(),
      { status: 500, json: { error: "boom" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    mount(auth);

    await waitFor(() => expect(text("status")).toBe("unauthenticated"));
    expect(text("error")).toContain("500");
  });

  it("picks up a login that happens after mount", async () => {
    // Bootstrap with no stored tokens never reaches the network — the client
    // rejects locally — so the queue starts at the login below.
    const { fetch } = stubFetch([tokenResponse(), meResponse()]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    mount(auth);
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));

    await act(async () => {
      await auth.login("ana@app.com", "pw");
    });

    await waitFor(() => expect(text("status")).toBe("authenticated"));
    expect(text("email")).toBe("ana@app.com");
  });

  it("clears the user on logout", async () => {
    const { fetch } = stubFetch([
      tokenResponse(),
      meResponse(),
      { status: 204 },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    mount(auth);
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    await act(async () => {
      await auth.logout();
    });

    expect(text("status")).toBe("unauthenticated");
    expect(text("email")).toBe("-");
  });

  it("calls onSessionExpired when the server drops the session", async () => {
    const { fetch } = stubFetch([
      tokenResponse(),
      meResponse(),
      unauthorized, // the refresh below is rejected
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    let expired = 0;
    mount(auth, () => {
      expired += 1;
    });
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    await act(async () => {
      await auth.refresh().catch(() => {});
    });

    expect(expired).toBe(1);
    expect(text("status")).toBe("unauthenticated");
  });

  /// An explicit logout is not a forced one — an app that hard-redirects on
  /// `onSessionExpired` would double-navigate if this fired too.
  it("does not call onSessionExpired on an explicit logout", async () => {
    const { fetch } = stubFetch([
      tokenResponse(),
      meResponse(),
      { status: 204 },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
    await auth.login("ana@app.com", "pw");

    let expired = 0;
    mount(auth, () => {
      expired += 1;
    });
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    await act(async () => {
      await auth.logout();
    });

    expect(expired).toBe(0);
  });

  it("exposes the login error and stays unauthenticated", async () => {
    const { fetch } = stubFetch([
      { status: 401, json: { error: "invalid credentials" } },
    ]);
    const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });

    function LoginProbe() {
      const { login, error, status } = useAuth();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="error">{error?.message ?? "-"}</span>
          <button
            onClick={() => {
              void login("ana@app.com", "wrong").catch(() => {});
            }}
          >
            go
          </button>
        </div>
      );
    }
    render(
      <GatewardProvider auth={auth}>
        <LoginProbe />
      </GatewardProvider>,
    );
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));

    await act(async () => {
      screen.getByText("go").click();
    });

    await waitFor(() => expect(text("error")).toContain("invalid credentials"));
    expect(text("status")).toBe("unauthenticated");
  });

  it("throws a useful error when useAuth is used outside the provider", () => {
    expect(() => render(<Probe />)).toThrow(/inside <GatewardProvider>/);
  });
});
