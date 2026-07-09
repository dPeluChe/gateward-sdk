import { HttpClient } from "../core/http.js";
import { AuthSession, type SessionOptions } from "../core/session.js";
import type { TokenSet } from "../core/storage.js";
import type {
  FetchLike,
  RegisterResponse,
  SessionSummary,
  TokenResponse,
} from "../core/types.js";

export interface GatewardAuthOptions extends SessionOptions {
  baseUrl: string;
  /** App id — sent as `X-Gateward-App-Id`, required for auth endpoints. */
  appId: string;
  /** Custom fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
}

/** Browser/user-facing auth client: register, login, automatic refresh,
 *  logout, and the caller's own sessions. App-scoped — every request carries
 *  `X-Gateward-App-Id`. Token lifecycle comes from {@link AuthSession}. */
export class GatewardAuth extends AuthSession {
  constructor(opts: GatewardAuthOptions) {
    super(
      new HttpClient({
        baseUrl: opts.baseUrl,
        appId: opts.appId,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      }),
      opts,
    );
  }

  /** Register a user into this app. Does not log in (no tokens issued). */
  register(email: string, password: string): Promise<RegisterResponse> {
    return this.http.request<RegisterResponse>("POST", "/v1/auth/register", {
      body: { email, password },
    });
  }

  /** Log in and persist the returned token pair. */
  async login(email: string, password: string): Promise<TokenSet> {
    const tokens = await this.http.request<TokenResponse>("POST", "/v1/auth/login", {
      body: { email, password },
    });
    return this.persist(tokens);
  }

  /** List the caller's own active sessions. */
  listSessions(): Promise<SessionSummary[]> {
    return this.authedRequest<SessionSummary[]>("GET", "/v1/sessions");
  }

  /** Revoke one of the caller's sessions by id. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.authedRequest<void>("DELETE", `/v1/sessions/${sessionId}`);
  }
}
