// Browser + shared entry. Server-to-server helpers (API key, event
// ingestion) live in the `@gateward/sdk/server` subpath.
export { GatewardAuth, type GatewardAuthOptions } from "./auth/client.js";
export {
  GatewardPlatform,
  type GatewardPlatformOptions,
} from "./platform/client.js";
export { type SessionOptions } from "./core/session.js";
export { GatewardError } from "./core/errors.js";
export {
  MemoryStorage,
  createWebStorage,
  type TokenStorage,
  type TokenSet,
} from "./core/storage.js";
export { HttpClient, type RequestHooks } from "./core/http.js";
export { resolveDeviceId } from "./core/device.js";
export {
  JwtVerifier,
  decodeClaims,
  type VerifyOptions,
} from "./jwt/verify.js";
export type {
  GatewardClaims,
  TokenResponse,
  RegisterResponse,
  SessionSummary,
  EventRecord,
  ActorKind,
  Jwk,
  JwksResponse,
  FetchLike,
  // Admin / management schemas (GatewardPlatform helpers)
  UserSummary,
  AdminSessionSummary,
  UpdateUserStatus,
  ListUsersQuery,
  EcosystemResponse,
  CreateEcosystemRequest,
  IdentityPoolResponse,
  CreateIdentityPoolRequest,
  AppResponse,
  CreateAppRequest,
  ApiKeyResponse,
  ApiKeySummary,
  CreateApiKeyRequest,
  ListApiKeysQuery,
  ListEventsQuery,
  ForgotPasswordResponse,
  ResendVerificationEmailResponse,
} from "./core/types.js";
