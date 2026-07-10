import type { components } from "../generated/api.js";

/** Convenient aliases over the OpenAPI-generated schema objects. */
type Schemas = components["schemas"];

// Client/integrator surface only — admin/management schemas are intentionally
// NOT exported here; the admin dashboard generates its own from the contract.
export type TokenResponse = Schemas["TokenResponse"];
export type RegisterResponse = Schemas["RegisterResponse"];
export type SessionSummary = Schemas["SessionSummary"];
export type EventRecord = Schemas["EventRecord"];
export type ActorKind = Schemas["ActorKind"];
export type Jwk = Schemas["Jwk"];
export type JwksResponse = Schemas["JwksResponse"];
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
