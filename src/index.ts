// Browser + shared entry. Server-to-server helpers (API key, event
// ingestion) live in the `@gateward/sdk/server` subpath.
export { GatewardAuth, type GatewardAuthOptions } from "./auth/client.js";
// AuthSession is the reusable token-lifecycle base (auto-refresh, single-flight,
// 401 retry, logout, authedRequest). Extend it to build an admin/platform
// client outside this package without shipping admin surface to integrators.
export { AuthSession, type SessionOptions } from "./core/session.js";
export type {
  AuthEvent,
  AuthStateChange,
  AuthStateListener,
} from "./core/events.js";
export { GatewardError } from "./core/errors.js";
export {
  MemoryStorage,
  createWebStorage,
  type TokenStorage,
  type TokenSet,
} from "./core/storage.js";
export {
  HttpClient,
  type RequestHooks,
  type RetryOptions,
} from "./core/http.js";
export { resolveDeviceId } from "./core/device.js";
export { resolveTimezone } from "./core/timezone.js";
export {
  JwtVerifier,
  decodeClaims,
  type VerifyOptions,
} from "./jwt/verify.js";
export type {
  GatewardClaims,
  GatewardUser,
  TokenResponse,
  RegisterResponse,
  SessionSummary,
  EventRecord,
  ActorKind,
  Jwk,
  JwksResponse,
  FetchLike,
  ForgotPasswordResponse,
  ResendVerificationEmailResponse,
} from "./core/types.js";
