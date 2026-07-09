# Gateward SDK (TypeScript)

SDK cliente de Gateward para **browser** y **backend**. Consume el Core por API y
**genera sus tipos desde el contrato OpenAPI** (`GET /api-docs/openapi.json`), no a mano.

- `@gateward/sdk` — auth de usuario (register/login/refresh automático/logout), sesiones
  propias, y verificación local de JWT (ES256 vía JWKS).
- `@gateward/sdk/server` — server-to-server con API key (`X-API-Key`): `sendEvent`,
  `listEvents`, y `verifyToken`.

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

// Verificación local del access token (ES256, sin llamar al Core).
// audience = el app_id (o "gateward:platform" para tokens de admin).
const claims = await gw.verifyToken(userAccessToken, "<APP_ID>");
```

La verificación descarga el JWKS una vez (`/.well-known/jwks.json`), lo cachea (TTL
1h, igual que el `Cache-Control` del Core) y refetchea si aparece un `kid` desconocido
(rotación de claves).

## Errores

Toda respuesta no-2xx (o fallo de red) lanza `GatewardError` con `.status` y `.body`,
más los helpers `.isUnauthorized` / `.isForbidden` / `.isRateLimited`.

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
