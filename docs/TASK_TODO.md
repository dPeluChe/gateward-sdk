# Gateward SDK — Task Backlog

> Tracking activo del SDK. Uso en el [README](../README.md), decisiones de
> diseño en [ARCHITECTURE/SESSION.md](./ARCHITECTURE/SESSION.md), integración
> en [GUIDES/MIGRATION.md](./GUIDES/MIGRATION.md).

---

## Estado `updated: 2026-08-03`

Superficie de cliente/integrador **completa contra el contrato**: auth, perfil
propio, password, sesiones, roles de app, eventos y verificación de JWT. Lo no
cubierto es admin/control-plane, que por diseño vive en el dashboard.

`main`: PRs #9-#16, 108 tests, 4 entries (`index`, `server`, `react`, `next`).

Próximo paso: **publicar** y que el dev de tennispro lo aplique. Su feedback
manda sobre el resto del backlog.

---

## Priority 1 — Desbloquear la primera integración

### DIST-001: Distribución pública `added: 2026-08-03`
- [x] Paquete publicable: MIT, `publishConfig` con provenance, metadata de repo.
- [x] CHANGELOG + política SemVer (`GUIDES/RELEASING.md`).
- [x] Workflow de release por tag, con guarda tag/package.json.
- [ ] Crear la org `gateward` en npm y el secret `NPM_TOKEN`.
- [ ] Primer `npm publish` — lo corre una persona, no CI (irreversible).

### DEMO-001: Poner el demo al día `added: 2026-08-03`
- [ ] `gateward-sdk-demo` está atrás de la superficie actual: no ejercita
  `updateProfile`, `changePassword`, `revokeAllSessions`, `listMembers` /
  `setMemberRole`, ni el auto-login del register.
- [ ] Es la referencia de integración que va a leer el dev de tennispro, así que
  vale más que la doc escrita.

### PILOT-TENNISPRO: Primera integración real `added: 2026-08-03`
- [ ] La aplica el dev de tennispro; nosotros respondemos su feedback.
- [ ] Análisis previo en `GUIDES/MIGRATION.md` (Patrón A). Riesgo principal: las
  queries/mutations de Convex no pueden hacer `fetch`, así que no verifican un
  JWT por sí solas — depende de OIDC-001 del Core (ver abajo).

---

## Priority 2 — Después del primer feedback

### PY-001: SDK de Python `added: 2026-08-03`
- [ ] Verificación de token (JWKS + ES256) y cliente de eventos para backends
  Python: skysset (Django/DRF), feedby (FastAPI), henri (Django).
- [ ] **Diferido a propósito**: ninguno de los tres está migrando todavía, y
  tennispro es TypeScript. Se retoma cuando la primera integración esté cerrada.
- [ ] Alcance estimado: `verify_token` + `send_event`, ~150 LOC. No necesita
  paridad con el SDK de TS — un backend Python no hace login de usuario.

### E2E-001: Validar contra un Core desplegado `added: 2026-08-03`
- [ ] Todo el suite corre contra stubs. Falta ejercitar el ciclo completo contra
  `gateward.fondor.space` (pendiente de redespliegue) con dos apps: una con
  `require_email_verification` y otra sin.

---

## Bloqueado por el Core

Reportado al equipo del Core; el SDK no puede avanzar sin esto.

| Pedido | Qué desbloquea |
|---|---|
| **OIDC-001** — `/.well-known/openid-configuration` | Convex valida JWTs de un proveedor OIDC de forma nativa dentro de queries. Sin esto, cada app Convex necesita tabla espejo y action de intercambio. **5 de los 7 candidatos son Convex** |
| **HASH-IMPORT-001** — importar hash legacy, re-hash al primer login | Migrar usuarios existentes sin reset masivo ni login dual |
| **SELF-DELETE-001** — borrar la propia cuenta | Requisito de GDPR y App Store. No existe en el contrato |
| `register` con perfil en el alta | tennispro, feedby, ligamx piden nombre en el mismo paso |
| **EMAIL-CHANGE-001** | tennispro |

---

## Backlog

### RBAC-001: Helpers de roles `added: 2026-08-03`
- [ ] ROLE-001 del Core ya permite asignar `app_admin`, y el SDK expone
  `listMembers`/`setMemberRole`. Falta decidir si el SDK opina sobre permisos
  (matriz rol → permiso) o eso se queda en cada app.
- [ ] newbase y henri tienen matrices RBAC casi idénticas — señal de que hay algo
  común, pero también de que cada una la quiere suya. Decidir con datos del
  primer piloto, no antes.

### STORAGE-001: Alternativa a localStorage `added: 2026-08-03`
- [ ] `createWebStorage()` deja los tokens expuestos a XSS. Documentado, pero no
  hay alternativa por cookie. Evaluar tras el primer piloto en producción.
