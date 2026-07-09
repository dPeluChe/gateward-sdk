# Gateward SDK (TypeScript)

SDK cliente de Gateward para browser y backend. **Consume el Core por API**; genera sus
tipos desde el contrato OpenAPI (`GET /api-docs/openapi.json`), no a mano.

Fase 2 / SDK-001. Scaffold por definir.

## Alcance previsto (SDK-001)
- Helpers de auth: register, login, refresh automático, logout.
- `sendEvent` y lectura de sesiones propias.
- Verificación local de JWT vía JWKS (`/.well-known/jwks.json`) — ES256, sin llamar al Core.
- Autenticación con API key (`X-API-Key`) para uso server-to-server.

## Notas del contrato (validadas en vivo 2026-07-08)
- `POST /v1/admin/api-keys` devuelve el campo **`key`** (no `api_key`), una sola vez.
- `POST /v1/auth/logout` requiere **`Authorization: Bearer <access>`** (no el refresh en body).
- Endpoints con `AppContext` requieren el header **`X-Gateward-App-Id`**.
