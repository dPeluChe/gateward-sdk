# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/), versionado
según [SemVer](https://semver.org/).

El SDK versiona **su propia API**, no la del Core. Un endpoint nuevo en el Core
que el SDK expone es `minor`; cambiar la firma de un método existente es
`major`. Ver [docs/GUIDES/RELEASING.md](./docs/GUIDES/RELEASING.md).

## [Unreleased]

### Added

- **Distribución pública** — el paquete deja de ser `private`, se publica como
  `@gateward/sdk` en npm bajo MIT, con provenance desde CI por tag.
- Este CHANGELOG y la política de releases.

## [0.1.0] — sin publicar

Primera superficie completa de cliente/integrador. Todo lo de abajo ya está en
`main`; se numera 0.1.0 al publicar.

### Auth de usuario

- `GatewardAuth`: `register`, `login`, `logout`, refresh automático
  single-flight con reintento tras 401, y storage pluggable (#1-#5).
- `register()` persiste tokens y emite `signed_in` cuando la app corre con
  `require_email_verification: false` (#15).
- `getUser()` — `GET /v1/auth/me`, cacheado por sesión, llamadas concurrentes
  comparten un request (#9).
- `getClaims()` — decodifica el access token sin round-trip. **No verificado**:
  pistas de UI, no autorización (#9).
- `updateProfile()`, `changePassword()`, `revokeAllSessions()` (#9, #15).
- `listSessions()` / `revokeSession()` (#1).
- Recuperación de cuenta: `forgotPassword`, `resetPassword`, `verifyEmail`,
  `resendVerificationEmail` (#4).

### Estado de sesión

- `onAuthStateChange()` con cuatro eventos. `session_expired` está separado de
  `signed_out` a propósito: antes, un refresh token muerto limpiaba el storage
  en silencio y la UI seguía pintando una sesión inexistente (#9).
- Sincronización entre pestañas vía el evento `storage`; un logout en una
  pestaña se propaga a las demás. `syncTabs: false` lo apaga (#13).

### Roles de app

- `listMembers` / `getMember` / `setMemberRole` en ambos clientes. Cambiar el
  **propio** rol fuerza un refresh, porque los scopes solo se re-derivan ahí y
  la UI gatearía con permisos viejos hasta 15 min (#16).

### Llamadas a tu propia API

- `createFetch()` — adjunta el bearer, refresca cerca de la expiración,
  reintenta una vez tras 401. Sin sesión pasa sin firmar; si el refresh falla
  devuelve el 401 original. `origins` acota a qué hosts va el token (#11).

### SSR

- `@gateward/sdk/next` — cookie marcadora no secreta + middleware. No importa
  nada de `next`: sirve en Remix, SvelteKit o Hono (#12).

### React

- `@gateward/sdk/react` — `<GatewardProvider>`, `useAuth()`, `useUser()`.
  `react` es peer dependency opcional (#10).

### Server-to-server

- `@gateward/sdk/server` — `sendEvent`, `listEvents`, `getUserMetadata` /
  `updateUserMetadata`, y `verifyToken` local vía JWKS con cache y refetch al
  ver un `kid` desconocido (#1-#8).

### Transporte

- Retry idempotency-aware: 429 en cualquier método, red y 502/503/504 solo en
  idempotentes — nunca POST/PATCH (#5).
- Hooks de observabilidad; un hook que tira error no rompe el request (#4).
- `X-Gateward-Device-Id` estable y `X-Gateward-Timezone` automáticos (#3, #7).
- `X-Total-Count` expuesto en listados paginados (#16).

### Tipos

- Generados del contrato OpenAPI del Core, nunca a mano (`pnpm gen:contract`).
