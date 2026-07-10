import { HttpClient, type RequestHooks } from "../core/http.js";
import { AuthSession, type SessionOptions } from "../core/session.js";
import type { TokenSet } from "../core/storage.js";
import type { FetchLike, TokenResponse } from "../core/types.js";
import { PlatformResources } from "./resources.js";

export interface GatewardPlatformOptions extends SessionOptions {
  baseUrl: string;
  /** Observability hooks (onRequest/onResponse/onError). */
  hooks?: RequestHooks;
  /** Custom fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
}

/** Platform-admin client for the dashboard: platform login, automatic
 *  refresh, logout, and typed helpers over the admin/management endpoints
 *  (`platform.users.list(...)`, `platform.apiKeys.create(...)`, …). NOT
 *  app-scoped — no `X-Gateward-App-Id`; tokens carry the `gateward:platform`
 *  audience. `authedRequest` stays available for anything not yet wrapped. */
export class GatewardPlatform extends AuthSession {
  readonly ecosystems: PlatformResources["ecosystems"];
  readonly identityPools: PlatformResources["identityPools"];
  readonly apps: PlatformResources["apps"];
  readonly users: PlatformResources["users"];
  readonly sessions: PlatformResources["sessions"];
  readonly apiKeys: PlatformResources["apiKeys"];
  readonly events: PlatformResources["events"];

  constructor(opts: GatewardPlatformOptions) {
    super(
      new HttpClient({
        baseUrl: opts.baseUrl,
        ...(opts.hooks ? { hooks: opts.hooks } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      }),
      opts,
    );
    const res = new PlatformResources(this);
    this.ecosystems = res.ecosystems;
    this.identityPools = res.identityPools;
    this.apps = res.apps;
    this.users = res.users;
    this.sessions = res.sessions;
    this.apiKeys = res.apiKeys;
    this.events = res.events;
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
