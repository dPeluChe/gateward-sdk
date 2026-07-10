# Gateward SDK (TypeScript)

SDK de **integración** de Gateward para las apps que lo usan como identity provider
(browser + backend). Consume el Core por API y **genera sus tipos desde el contrato
OpenAPI** (`GET /api-docs/openapi.json`), no a mano.

- `@gateward/sdk` — auth de usuario (register/login/refresh automático/logout), sesiones
  propias, y verificación local de JWT (ES256 vía JWKS).
- `@gateward/sdk/server` — server-to-server con API key (`X-API-Key`): `sendEvent`,
  `listEvents`, `getUserMetadata`/`updateUserMetadata`, y `verifyToken`.

> **Alcance:** este SDK cubre la superficie de **cliente/integrador** solamente. Las
> operaciones de **admin/control-plane** (gestión de ecosystems, usuarios, api keys, ver
> todos los eventos) **no** viven acá — son del dashboard admin, construidas sobre el
> primitivo `AuthSession` que este paquete exporta. Así ningún integrador hereda superficie
> admin.

## Instalación

```bash
pnpm add @gateward/sdk
```

## Auth de usuario (browser/backend)

```ts
import { GatewardAuth, createWebStorage } from "@gateward/sdk";

const auth = new GatewardAuth({
  baseUrl: "https://gateward.fondor.space",
  appId: "<APP_ID>", // enviado como X-Gateward-App-Id
  storage: createWebStorage(), // opcional; por defecto en memoria
});

await auth.register("user@app.com", "s3cret");
await auth.login("user@app.com", "s3cret");

// getAccessToken() refresca solo si el token está por expirar (single-flight).
const token = await auth.getAccessToken();

// Helper autenticado: adjunta el Bearer y reintenta 1 vez tras un 401 (refresh).
const sessions = await auth.listSessions();
await auth.revokeSession(sessions[0].id);

await auth.logout(); // revoca en el server y limpia el storage (best-effort)
```

`GatewardAuth` guarda el par de tokens en un `TokenStorage` pluggable
(`MemoryStorage` por defecto, `createWebStorage()` para `localStorage`, o el tuyo).

Manda automáticamente un **`X-Gateward-Device-Id`** estable (generado y persistido
en `localStorage` en el browser) para que el Core reconozca el mismo dispositivo entre
sesiones, y un **`X-Gateward-Timezone`** (IANA, detectado vía `Intl`). Controlables con
`deviceId` / `timezone` (o `false` para desactivar). El Core, además, captura IP real
(behind proxy) + navegador/OS del User-Agent en cada login/refresh.

## Server-to-server (API key)

```ts
import { GatewardServer } from "@gateward/sdk/server";

const gw = new GatewardServer({
  baseUrl: "https://gateward.fondor.space",
  apiKey: process.env.GATEWARD_API_KEY!, // scope events:write / events:read_app
  issuer: "https://gateward.fondor.space",
});

// sendEvent — el event_type debe estar namespaced (contener un ".").
await gw.sendEvent({
  eventType: "app.checkout.completed",
  userId: "<USER_ID>", // opcional; debe pertenecer al pool de la key
  metadata: { amount: 42 },
});

const events = await gw.listEvents({ eventType: "app.checkout.completed", limit: 20 });

// Per-app user metadata (scopes users:read_app / users:write_app).
await gw.updateUserMetadata("<USER_ID>", { tier: "gold" }); // shallow-merge
const meta = await gw.getUserMetadata("<USER_ID>");

// Verificación local del access token (ES256, sin llamar al Core).
// audience = el app_id (o "gateward:platform" para tokens de admin).
const claims = await gw.verifyToken(userAccessToken, "<APP_ID>");
```

La verificación descarga el JWKS una vez (`/.well-known/jwks.json`), lo cachea (TTL
1h, igual que el `Cache-Control` del Core) y refetchea si aparece un `kid` desconocido
(rotación de claves).

## Admin / control-plane

Las operaciones de platform_admin (ecosystems, usuarios, api keys, todos los eventos) **no
están en este SDK** — son del dashboard admin. Se construyen extendiendo el primitivo
`AuthSession` que este paquete exporta (trae el ciclo de tokens: refresh automático
single-flight, reintento 401, storage) y llamando `authedRequest(method, path, opts)`.
Ver el módulo `src/lib/gateward/` del repo `gateward-dashboard`.

> El browser hablando cross-origin con el Core necesita CORS: configurá
> `CORS_ALLOWED_ORIGINS` en el Core (HARDEN-001) con el origen del dashboard.

## Errores y observabilidad

Toda respuesta no-2xx (o fallo de red) lanza `GatewardError` con `.status` y `.body`,
más los helpers `.isUnauthorized` / `.isForbidden` / `.isRateLimited`.

Para logging/metrics, pasá `hooks` a cualquier cliente:

```ts
new GatewardPlatform({
  baseUrl,
  hooks: {
    onRequest: ({ method, path }) => log.debug(`${method} ${path}`),
    onError: ({ path, error }) => metrics.inc("gateward.error", { path, status: error.status }),
  },
});
```

## Retry automático (opcional)

Pasá `retry` a cualquier cliente (`true` para defaults, u objeto para tunear). Es
**idempotency-aware**:

```ts
new GatewardServer({ baseUrl, apiKey, retry: true });
new GatewardAuth({ baseUrl, appId, retry: { maxRetries: 3, baseDelayMs: 200 } });
```

- **429** → reintenta en cualquier método (el server rechazó antes de procesar), respetando `Retry-After`.
- **Error de red / 502·503·504** → reintenta **solo** en métodos idempotentes (GET/HEAD/OPTIONS/DELETE/PUT). **Nunca** POST/PATCH — podrían re-ejecutarse (ej. un `sendEvent` duplicado).
- Backoff exponencial con jitter, cortable por `AbortSignal`. Desactivado por default.

## Recuperación de cuenta

`GatewardAuth` también expone: `forgotPassword(email)`, `resetPassword(token, newPassword)`,
`verifyEmail(token)`, `resendVerificationEmail(email)`.

## Regenerar tipos desde el contrato

Los tipos en `src/generated/api.ts` se derivan del contrato real. Para regenerarlos
contra el Core local:

```bash
pnpm gen:contract   # corre el bin dump_openapi del Core → openapi.json → gen:types
# o, si ya tenés openapi.json:
pnpm gen:types
```

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm build` | Bundle ESM+CJS+d.ts con tsup |
| `pnpm test` | Suite vitest |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm gen:types` | `openapi.json` → `src/generated/api.ts` |
| `pnpm gen:contract` | Dumpea el contrato del Core y regenera tipos |

## Notas del contrato (validadas en vivo 2026-07-08)

- `POST /v1/admin/api-keys` devuelve el campo **`key`** (no `api_key`), una sola vez.
- `POST /v1/auth/logout` requiere **`Authorization: Bearer <access>`** (no el refresh en body).
- Endpoints con `AppContext` requieren el header **`X-Gateward-App-Id`**.
- `POST /v1/events` (sendEvent) exige scope `events:write` y `event_type` namespaced.
