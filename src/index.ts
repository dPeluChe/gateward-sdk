// Browser + shared entry. Server-to-server helpers (API key, event
// ingestion) live in the `@gateward/sdk/server` subpath.
export { GatewardAuth, type GatewardAuthOptions } from "./auth/client.js";
export { GatewardError } from "./core/errors.js";
export {
  MemoryStorage,
  createWebStorage,
  type TokenStorage,
  type TokenSet,
} from "./core/storage.js";
export { HttpClient } from "./core/http.js";
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
} from "./core/types.js";
