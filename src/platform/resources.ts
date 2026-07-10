import type {
  AdminSessionSummary,
  AppResponse,
  ApiKeyResponse,
  ApiKeySummary,
  CreateApiKeyRequest,
  CreateAppRequest,
  CreateEcosystemRequest,
  CreateIdentityPoolRequest,
  EcosystemResponse,
  EventRecord,
  IdentityPoolResponse,
  ListApiKeysQuery,
  ListEventsQuery,
  ListUsersQuery,
  UpdateUserStatus,
  UserSummary,
} from "../core/types.js";

/** The bit of the platform client the resources need: an authed request. */
export interface Requester {
  authedRequest<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; query?: Record<string, unknown> },
  ): Promise<T>;
}

/** Typed helpers over the admin/management endpoints, so callers write
 *  `platform.users.list({ ecosystem_id })` instead of a raw path + cast. */
export class PlatformResources {
  constructor(private readonly r: Requester) {}

  readonly ecosystems = {
    list: (): Promise<EcosystemResponse[]> =>
      this.r.authedRequest("GET", "/v1/ecosystems"),
    create: (body: CreateEcosystemRequest): Promise<EcosystemResponse> =>
      this.r.authedRequest("POST", "/v1/ecosystems", { body }),
  };

  readonly identityPools = {
    list: (query: { ecosystem_id?: string } = {}): Promise<
      IdentityPoolResponse[]
    > => this.r.authedRequest("GET", "/v1/identity-pools", { query }),
    create: (
      body: CreateIdentityPoolRequest,
    ): Promise<IdentityPoolResponse> =>
      this.r.authedRequest("POST", "/v1/identity-pools", { body }),
  };

  readonly apps = {
    list: (query: { ecosystem_id?: string } = {}): Promise<AppResponse[]> =>
      this.r.authedRequest("GET", "/v1/apps", { query }),
    create: (body: CreateAppRequest): Promise<AppResponse> =>
      this.r.authedRequest("POST", "/v1/apps", { body }),
  };

  readonly users = {
    list: (query: ListUsersQuery = {}): Promise<UserSummary[]> =>
      this.r.authedRequest("GET", "/v1/admin/users", { query }),
    get: (id: string): Promise<UserSummary> =>
      this.r.authedRequest("GET", `/v1/admin/users/${id}`),
    updateStatus: (id: string, body: UpdateUserStatus): Promise<UserSummary> =>
      this.r.authedRequest("PATCH", `/v1/admin/users/${id}`, { body }),
    sessions: (id: string): Promise<AdminSessionSummary[]> =>
      this.r.authedRequest("GET", `/v1/admin/users/${id}/sessions`),
  };

  readonly sessions = {
    revoke: (id: string): Promise<void> =>
      this.r.authedRequest("DELETE", `/v1/admin/sessions/${id}`),
  };

  readonly apiKeys = {
    list: (query: ListApiKeysQuery = {}): Promise<ApiKeySummary[]> =>
      this.r.authedRequest("GET", "/v1/admin/api-keys", { query }),
    /** The plaintext `key` is returned once — surface it, don't persist it. */
    create: (body: CreateApiKeyRequest): Promise<ApiKeyResponse> =>
      this.r.authedRequest("POST", "/v1/admin/api-keys", { body }),
    revoke: (id: string): Promise<void> =>
      this.r.authedRequest("DELETE", `/v1/admin/api-keys/${id}`),
  };

  readonly events = {
    /** Platform-admin view: all events (`/v1/admin/events`). */
    list: (query: ListEventsQuery = {}): Promise<EventRecord[]> =>
      this.r.authedRequest("GET", "/v1/admin/events", { query }),
  };
}
