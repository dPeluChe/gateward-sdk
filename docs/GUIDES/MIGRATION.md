# Migrar una app a Gateward

Guía por **patrón de auth**: la mayoría de las apps caen en uno de cinco. Cada
sección dice qué se tira, qué se queda, y el diff mínimo.

Referencia de uso en el [README](../../README.md); el porqué de cada primitiva
en [ARCHITECTURE/SESSION.md](../ARCHITECTURE/SESSION.md).

## Antes de empezar

1. Aprovisioná en el dashboard: ecosystem → identity pool → app. Guardá el
   `app_id`.
2. Si tu backend va a verificar tokens o emitir eventos, creá una API key con
   los scopes que necesite (`events:write`, `users:read_app`, …).
3. Agregá el origen de tu app a `CORS_ALLOWED_ORIGINS` del Core. Sin esto el
   browser no puede hablarle.

```bash
pnpm add @gateward/sdk
```

## Mapa de equivalencias

| Lo que tenías | Con el SDK |
|---|---|
| `login(email, password)` propio | `auth.login(email, password)` |
| tabla `users` + bcrypt propio | el Core; tu tabla guarda solo lo tuyo |
| `sessionToken` en localStorage | `createWebStorage()` (o el tuyo) |
| tu refresh manual | automático, single-flight |
| `getCurrentUser()` | `auth.getUser()` |
| `updateProfile(...)` | `auth.updateProfile({...})` |
| `changePassword(...)` | `auth.changePassword(actual, nueva)` |
| provider + hook a mano | `@gateward/sdk/react` |
| interceptor axios/fetch | `auth.createFetch()` |
| gate de middleware Next | `@gateward/sdk/next` |

**Dónde vive el perfil.** Gateward guarda identidad (email, estado, rol de
membership). El nombre visible, avatar, preferencias y el **rol de tu app** van
en `metadata`, que es `app_memberships.local_metadata`. Se lee con `getUser()`
y se escribe con `updateProfile()`.

> `metadata` la escribe el propio usuario. Úsala para mostrar, **nunca para
> autorizar**. Para autorizar, mirá `membership_role` o los `scopes` del token
> verificado en tu backend.

---

## Patrón A — Singleton + subscribe (Convex)

**Ejemplo típico:** una SPA de Vite + React sobre Convex, con un `AuthService`
singleton que expone `subscribe()`, más un `AuthProvider` y un `useAuth`
propios. El token de sesión es opaco y lo emite una action de Convex.

Es el más fácil: la forma ya es idéntica a la del SDK.

- `login` / `logout` / `registerUser` del singleton → métodos de `GatewardAuth`.
- `subscribe(listener)` → `onAuthStateChange()`. Ojo: el SDK distingue
  `signed_out` de `session_expired`; el singleton no lo hacía y por eso la UI
  podía quedar mostrando una sesión muerta.
- `AuthProvider` + `useAuth` propios → los de `@gateward/sdk/react`. El
  `status: 'loading' | 'authenticated' | 'unauthenticated'` ya existe.
- `hydrateSession()` / `ready()` → lo hace el provider al montar.
- Los roles propios de la app van a `metadata.role`. La función que decide a
  qué pantalla cae cada rol se queda en tu código, leyendo de ahí.

Convex sigue siendo tu base de datos: se le saca **solo** la tabla de usuarios y
el módulo de credenciales. Las funciones que hoy reciben un `sessionToken` pasan
a verificar el JWT de Gateward.

## Patrón B — NextAuth v4 + Convex

**Ejemplo típico:** una app Next.js con `CredentialsProvider` contra Convex,
sesión JWT de NextAuth y el rol inyectado en el callback `session`.

- Se va `next-auth` entero: provider, callbacks, `/api/auth/[...nextauth]`,
  `types/next-auth.d.ts`.
- `<SessionProvider>` → `<GatewardProvider>`.
- `useSession()` → `useAuth()`. `status` de NextAuth es
  `loading | authenticated | unauthenticated`: **los mismos tres valores**, así
  que los componentes casi no cambian.
- `session.user.role` → `user.metadata.role` (el de tu app) o
  `user.membership_role` (el de Gateward).
- El `middleware.ts` pasa a `createGatewardMiddleware` — ver Patrón E.
- Tu matriz RBAC **se queda como está**. Sigue siendo tuya; solo cambia de
  dónde sale el rol que le pasás.

⚠ El bootstrap "primer usuario = admin" no es automático: el primer `app_admin`
lo promueve un platform admin, porque dentro de la app todavía no hay nadie con
`app:user_manage`.

## Patrón C — Store + interceptor (zustand/axios)

**Ejemplo típico:** un store de zustand persistido con user + tokens, con
mirror a localStorage para que el interceptor de axios los lea.

- El store deja de guardar tokens: eso es del SDK. Guarda solo estado de UI.
- Tu módulo de storage → `createWebStorage()`. Si versionabas las claves
  (`:v1`) era buena idea; el SDK usa una sola, así que para forzar un sign-out
  global cambiá su nombre.
- El interceptor de axios → `auth.createFetch()`, o dejá axios y usá
  `auth.getAccessToken()` en el interceptor.
- Si tu `register()` devolvía tokens (auto-login), **eso se puede**:
  aprovisioná la app con `require_email_verification: false` y `register()`
  persiste los tokens y emite `signed_in`. Con la verificación activa, el flujo
  es registro → "revisá tu correo" → login.

## Patrón D — JWT propio + localStorage

**Ejemplo típico:** un dashboard Next con access+refresh en localStorage,
refresh single-flight, cookie marcadora y un bus de forced-logout. Es el patrón
que más se parece a Gateward.

Casi todo se borra porque el SDK ya lo trae:

| Lo que tenías | Reemplazo |
|---|---|
| módulo de token store | `withSessionMarker(createWebStorage())` |
| bus de eventos de auth | `onAuthStateChange()` |
| middleware de refresh del cliente HTTP | `auth.createFetch()` |
| tu `AuthProvider` | `<GatewardProvider>` |
| tu cookie marcadora | `SESSION_MARKER_COOKIE` |

Tu `whoami()` → `getUser()`. Un chequeo tipo `user_type !== 'admin'` pasa a
`membership_role` o a `metadata`.

## Patrón E — Gating SSR en Next

Aplica a B y D. Reemplaza el `middleware.ts` hecho a mano:

```ts
import { createGatewardMiddleware } from "@gateward/sdk/next";

const gate = createGatewardMiddleware({
  protect: ["/dashboard", "/settings"],
  authenticatedHome: "/dashboard",
});

export function middleware(request: NextRequest) {
  return gate(request) ?? NextResponse.next();
}
```

Requiere que el cliente use `withSessionMarker(...)`, o el server nunca ve la
cookie.

> **No es autenticación.** Decide si el server pinta el layout autenticado, nada
> más. La cookie es falsificable; autorizá en tu API.

---

## Backend: verificar el token

Tu backend nunca confía en lo que le manda el browser. Verifica el JWT contra
el JWKS del Core, sin round-trip por request:

```ts
import { GatewardServer } from "@gateward/sdk/server";

const gw = new GatewardServer({ baseUrl, apiKey, issuer: baseUrl });
const claims = await gw.verifyToken(bearerToken, APP_ID);
// claims.sub = user id, claims.scopes = permisos
```

**Si tu backend es Python** (Django/DRF, FastAPI) todavía no hay SDK.
Opciones: verificar a mano con `PyJWT` + `PyJWKClient` contra
`/.well-known/jwks.json` (ES256), o esperar al SDK de Python.

## Checklist

- [ ] App aprovisionada, `app_id` a mano
- [ ] Origen en `CORS_ALLOWED_ORIGINS` del Core
- [ ] Storage elegido (`createWebStorage`, + `withSessionMarker` si hay SSR)
- [ ] Provider montado, `status === "loading"` renderiza un spinner **y no** la
      pantalla de login
- [ ] `onSessionExpired` conectado al redirect
- [ ] Llamadas a tu API firmadas con `createFetch({ origins: [...] })`
- [ ] Backend verificando el JWT con `verifyToken`
- [ ] Rol de tu app leído de `metadata`, autorizado en el backend
- [ ] Usuarios existentes migrados (ver abajo)

## Migrar usuarios existentes

**Los hashes se importan.** No hace falta reset masivo ni mantener dos logins
en paralelo — que era el camino peligroso.

`POST /v1/admin/users/import` acepta:

| Formato | De dónde suele venir |
|---|---|
| Argon2 | apps que ya usaban Argon2 |
| bcrypt (`$2a$`, `$2b$`, `$2y$`) | Node, Convex, Rails |
| `pbkdf2_sha256$…` | Django |

El re-hash a Argon2id pasa solo, en el primer login de cada usuario: para el
usuario es transparente, escribe su contraseña de siempre. Cualquier otro
formato se rechaza **en el import**, no en el primer login, así que te enterás
al migrar y no cuando el usuario no pueda entrar.

Detalles operativos (máximo 200 por request, veredicto por fila, una fila mala
no tumba el lote) en la guía `docs/GUIDES/user-migration.md` del Core.

Es superficie de admin, así que la corre un operador desde el dashboard — no la
app integrada, y por eso no está en este SDK.

> Para medir avance: contar usuarios cuyo `password_hash` no empiece con
> `$argon2`. Cuando llegue a cero, todos migraron.

Reimportar **nunca pisa credenciales vivas**, así que el import no sirve para
cambiar contraseñas — para eso está `forgotPassword()`.

## Ambientes de prueba

No hay un Core de staging aparte, y no hace falta: el aislamiento se arma
**dentro del mismo Core** con un identity pool propio y un app marcado
`environment: "test"`. Los usuarios de QA quedan en otro pool y no tocan los
reales.

Protegé el build con la guarda del SDK:

```ts
new GatewardAuth({ baseUrl, appId, expectEnvironment: "test" });
```

En apps de test conviene `require_email_verification: false`: sin SMTP
configurado el token de verificación solo queda en los logs del Core y no hay
forma de completar el alta desde afuera.

La prueba que de verdad valida el aislamiento es la última del checklist del
Core (`docs/GUIDES/integration-testing.md`): **el usuario de QA tiene que dar
401 contra el `app_id` de producción.** Corrémela antes de dar por buena una
integración.

## Bloqueadores conocidos

| Bloqueador | A quién afecta |
|---|---|
| Sin SDK de Python | backends Django/DRF y FastAPI |

Es el único que queda. Ya están resueltos: política de password por app (una app
puede exigir un PIN numérico corto en vez del mínimo por defecto), auto-login en
el alta, perfil en el registro, asignación de `app_admin`, cambio de email, baja
de cuenta, e import de hashes legacy.

Están reportados al equipo del Core.
