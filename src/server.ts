import {
  HttpClient,
  type RequestHooks,
  type RetryOptions,
} from "./core/http.js";
import { JwtVerifier } from "./jwt/verify.js";
import type {
  EventRecord,
  FetchLike,
  GatewardClaims,
} from "./core/types.js";

export interface GatewardServerOptions {
  baseUrl: string;
  /** Service-account API key, sent as `X-API-Key`. */
  apiKey: string;
  /** App id, sent as `X-Gateward-App-Id` when set. */
  appId?: string;
  /** Observability hooks (onRequest/onResponse/onError/onRetry). */
  hooks?: RequestHooks;
  /** Automatic retry (idempotency-aware). `true` for defaults. */
  retry?: RetryOptions | boolean;
  /** Custom fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
  /** Expected token issuer for {@link verifyToken} (recommended). */
  issuer?: string;
}

export interface SendEventInput {
  /** Namespaced event type, e.g. `app.checkout.completed` (must contain a `.`). */
  eventType: string;
  /** Optional user the event is about — must be in the key's identity pool. */
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ListEventsQuery {
  eventType?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

/** Server-to-server client authenticated by an API key. Emits events
 *  (`events:write`), reads them (`events:read_app`), and verifies access
 *  tokens locally via JWKS — no per-verify round-trip to the Core. */
export class GatewardServer {
  private readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly verifier: JwtVerifier;

  constructor(opts: GatewardServerOptions) {
    this.http = new HttpClient({
      baseUrl: opts.baseUrl,
      ...(opts.appId ? { appId: opts.appId } : {}),
      ...(opts.hooks ? { hooks: opts.hooks } : {}),
      ...(opts.retry !== undefined ? { retry: opts.retry } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.apiKey = opts.apiKey;
    this.verifier = new JwtVerifier({
      baseUrl: opts.baseUrl,
      ...(opts.issuer ? { issuer: opts.issuer } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  /** Emit a custom app event (requires the `events:write` scope). */
  async sendEvent(input: SendEventInput): Promise<void> {
    await this.http.request<void>("POST", "/v1/events", {
      apiKey: this.apiKey,
      body: {
        event_type: input.eventType,
        ...(input.userId ? { user_id: input.userId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }

  /** Read events scoped to this key's app (requires `events:read_app`). */
  listEvents(query: ListEventsQuery = {}): Promise<EventRecord[]> {
    return this.http.request<EventRecord[]>("GET", "/v1/events", {
      apiKey: this.apiKey,
      query: {
        event_type: query.eventType,
        user_id: query.userId,
        limit: query.limit,
        offset: query.offset,
      },
    });
  }

  /** Read this app's metadata for one of its users (requires `users:read_app`).
   *  Per-app data your backend stored on the membership — Gateward stays lean,
   *  your app owns the profile. */
  async getUserMetadata(userId: string): Promise<Record<string, unknown>> {
    const res = await this.http.request<{ metadata: Record<string, unknown> }>(
      "GET",
      `/v1/users/${userId}/metadata`,
      { apiKey: this.apiKey },
    );
    return res.metadata;
  }

  /** Shallow-merge `patch` into this app's metadata for a user (requires
   *  `users:write_app`). Existing top-level keys are preserved. Returns the
   *  merged metadata. */
  async updateUserMetadata(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.http.request<{ metadata: Record<string, unknown> }>(
      "PATCH",
      `/v1/users/${userId}/metadata`,
      { apiKey: this.apiKey, body: { metadata: patch } },
    );
    return res.metadata;
  }

  /** Verify a Gateward access token locally (ES256 via JWKS). Pass
   *  `audience` (the app id) to bind the token to your app. Throws on any
   *  invalid/expired/wrong-audience token. */
  verifyToken(token: string, audience?: string): Promise<GatewardClaims> {
    return this.verifier.verify(token, audience);
  }
}
