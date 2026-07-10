import type { components } from "../generated/api.js";

/** Convenient aliases over the OpenAPI-generated schema objects. */
type Schemas = components["schemas"];

export type TokenResponse = Schemas["TokenResponse"];
export type RegisterResponse = Schemas["RegisterResponse"];
export type SessionSummary = Schemas["SessionSummary"];
export type EventRecord = Schemas["EventRecord"];
export type ApiKeyResponse = Schemas["ApiKeyResponse"];
export type ActorKind = Schemas["ActorKind"];
export type Jwk = Schemas["Jwk"];
export type JwksResponse = Schemas["JwksResponse"];

// Admin / management schemas (used by the GatewardPlatform typed helpers).
export type UserSummary = Schemas["UserSummary"];
export type AdminSessionSummary = Schemas["AdminSessionSummary"];
export type UpdateUserStatus = Schemas["UpdateUserStatus"];
export type ListUsersQuery = Schemas["ListUsersQuery"];
export type EcosystemResponse = Schemas["EcosystemResponse"];
export type CreateEcosystemRequest = Schemas["CreateEcosystemRequest"];
export type IdentityPoolResponse = Schemas["IdentityPoolResponse"];
export type CreateIdentityPoolRequest = Schemas["CreateIdentityPoolRequest"];
export type AppResponse = Schemas["AppResponse"];
export type CreateAppRequest = Schemas["CreateAppRequest"];
export type ApiKeySummary = Schemas["ApiKeySummary"];
export type CreateApiKeyRequest = Schemas["CreateApiKeyRequest"];
export type ListApiKeysQuery = Schemas["ListApiKeysQuery"];
export type ListEventsQuery = Schemas["ListEventsQuery"];
export type ForgotPasswordResponse = Schemas["ForgotPasswordResponse"];
export type ResendVerificationEmailResponse =
  Schemas["ResendVerificationEmailResponse"];

/** A cross-platform `fetch` implementation (defaults to global `fetch`). */
export type FetchLike = typeof fetch;

/** Claims carried in a Gateward access token (ES256 JWT). Not part of the
 *  OpenAPI contract — mirrors the Core's `jwt::Claims`. */
export interface GatewardClaims {
  /** User (or service account) id. */
  sub: string;
  ecosystem_id: string;
  identity_pool_id: string;
  /** Absent for platform-admin tokens. */
  app_id?: string;
  session_id: string;
  actor_kind: ActorKind;
  scopes: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}
