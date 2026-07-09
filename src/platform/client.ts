import { HttpClient } from "../core/http.js";
import { AuthSession, type SessionOptions } from "../core/session.js";
import type { TokenSet } from "../core/storage.js";
import type { FetchLike, TokenResponse } from "../core/types.js";

export interface GatewardPlatformOptions extends SessionOptions {
  baseUrl: string;
  /** Custom fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
}

/** Platform-admin client for the dashboard: platform login, automatic
 *  refresh, logout. NOT app-scoped — no `X-Gateward-App-Id` header, and the
 *  tokens carry the `gateward:platform` audience. Call the admin/management
 *  endpoints via {@link AuthSession.authedRequest} (e.g. `/v1/admin/users`,
 *  `/v1/ecosystems`, `/v1/admin/api-keys`, `/v1/admin/events`). */
export class GatewardPlatform extends AuthSession {
  constructor(opts: GatewardPlatformOptions) {
    super(
      new HttpClient({
        baseUrl: opts.baseUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      }),
      opts,
    );
  }

  /** Log in as a platform admin and persist the returned token pair. */
  async platformLogin(email: string, password: string): Promise<TokenSet> {
    const tokens = await this.http.request<TokenResponse>(
      "POST",
      "/v1/auth/platform-login",
      { body: { email, password } },
    );
    return this.persist(tokens);
  }
}
