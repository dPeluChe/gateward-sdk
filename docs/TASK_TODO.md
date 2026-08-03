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

`main` en CI verde sobre Node 20 y 22.

Próximo paso: **publicar** y que la app piloto lo aplique. Su feedback manda
sobre el resto del backlog.

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
- [ ] Es la referencia de integración que se lee antes que la doc escrita, así
  que vale más que ella.

### PILOT-001: Primera integración real `added: 2026-08-03`
- [ ] La aplica el equipo de la app piloto; nosotros respondemos su feedback.
- [ ] Análisis previo en `GUIDES/MIGRATION.md`. Si la piloto corre sobre Convex,
  sus queries/mutations no pueden hacer `fetch` y no verifican un JWT por sí
  solas — se resuelve con el discovery OIDC del Core y `convex/auth.config.ts`,
  con `applicationID` = el UUID del app.

---

## Priority 2 — Después del primer feedback

### PY-001: SDK de Python `added: 2026-08-03`
- [ ] Verificación de token (JWKS + ES256) y cliente de eventos para backends
  Python (Django/DRF, FastAPI). **Es el único bloqueador que queda en la guía
  de migración.**
- [ ] **Diferido a propósito**: ninguno de sus consumidores está migrando
  todavía, y la app piloto es TypeScript. Se retoma cuando la primera
  integración esté cerrada.
- [ ] Alcance estimado: `verify_token` + `send_event`, ~150 LOC. No necesita
  paridad con el SDK de TS — un backend Python no hace login de usuario.

### E2E-001: Validar contra un Core desplegado `added: 2026-08-03`
- [ ] Todo el suite corre contra stubs. Falta ejercitar el ciclo completo contra
  un Core real con dos apps: una con `require_email_verification` y otra sin.
- [ ] **Bloqueado por el redespliegue de prod**, que aún no tiene ninguno de los
  diez PRs. Al desplegar, `JWT_ISSUER` tiene que ser la URL pública o el
  discovery OIDC no sirve — y el error se ve del lado del cliente, no del server.

---

## Bloqueado por el Core

**Nada.** Los diez pedidos se entregaron y están integrados en el SDK:
SELF-001, APP-POLICY-001, ROLE-001, OIDC-001, HASH-IMPORT-001, SELF-DELETE-001,
REGISTER-PROFILE-001, EMAIL-CHANGE-001, APP-CONFIG-001 y ABUSE-TENANT-001.

Lo único que falta del lado del Core es **operativo**: redesplegar prod, que
todavía corre sin ninguno de esos cambios.

---

## Backlog

### RBAC-001: Helpers de roles `added: 2026-08-03`
- [ ] El Core ya permite asignar `app_admin`, y el SDK expone
  `listMembers`/`setMemberRole`. Falta decidir si el SDK opina sobre permisos
  (matriz rol → permiso) o eso se queda en cada app.
- [ ] Varias apps auditadas tenían matrices RBAC casi idénticas — señal de que
  hay algo común, pero también de que cada una la quiere suya. Decidir con datos
  del primer piloto, no antes.

### STORAGE-001: Alternativa a localStorage `added: 2026-08-03`
- [ ] `createWebStorage()` deja los tokens expuestos a XSS. Documentado, pero no
  hay alternativa por cookie. Evaluar tras el primer piloto en producción.
