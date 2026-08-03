# Migrar una app a Gateward

Guía por **patrón de auth**, no por proyecto: la mayoría de las apps del
workspace caen en uno de cinco. Cada sección dice qué se tira, qué se queda, y
el diff mínimo.

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

**Ejemplo: `labs-tennispro` (`src/lib/auth.ts`).** Un `AuthService` singleton
con `subscribe()`, `AuthProvider` y `useAuth` propios; el token de sesión es
opaco y sale de una action de Convex.

Es el más fácil: la forma ya es idéntica a la del SDK.

- `AuthService.login/logout/registerUser` → métodos de `GatewardAuth`.
- `subscribe(listener)` → `onAuthStateChange()`. Ojo: el SDK distingue
  `signed_out` de `session_expired`; el singleton no lo hacía y por eso la UI
  podía quedar mostrando una sesión muerta.
- `AuthProvider` + `useAuth` propios → los de `@gateward/sdk/react`. El
  `status: 'loading' | 'authenticated' | 'unauthenticated'` ya existe.
- `hydrateSession()` / `ready()` → lo hace el provider al montar.
- Los 4 roles (`admin`, `tournament-organizer`, `player`, `venue-manager`) van
  a `metadata.role`. `getHomePathForUser()` se queda en tu código, leyendo de
  ahí.

Convex sigue siendo tu base de datos: se le saca **solo** la tabla `users` y
`convex/nextauth.ts`. Las actions que hoy reciben `sessionToken` pasan a
verificar el JWT de Gateward en tu backend.

## Patrón B — NextAuth v4 + Convex

**Ejemplo: `workspace-blueprints/labs-newbase`, `dpeluche.dev`
(`src/lib/auth.ts`).** `CredentialsProvider` que llama a Convex, sesión JWT de
NextAuth, rol en el callback `session`.

- Se va `next-auth` entero: provider, callbacks, `/api/auth/[...nextauth]`,
  `types/next-auth.d.ts`.
- `<SessionProvider>` → `<GatewardProvider>`.
- `useSession()` → `useAuth()`. `status` de NextAuth es
  `loading | authenticated | unauthenticated`: **los mismos tres valores**, así
  que los componentes casi no cambian.
- `session.user.role` → `user.metadata.role` (el de tu app) o
  `user.membership_role` (el de Gateward).
- El `middleware.ts` pasa a `createGatewardMiddleware` — ver Patrón E.
- La matriz RBAC (`src/lib/rbac.ts`) **se queda como está**. Sigue siendo tuya;
  solo cambia de dónde sale el rol que le pasás.

⚠ El bootstrap "primer usuario = admin" (`hasAnyUsers` en dpeluche.dev) no es
automático: el primer `app_admin` lo promueve un platform admin, porque dentro
de la app todavía no hay nadie con `app:user_manage`.

## Patrón C — Store + interceptor (zustand/axios)

**Ejemplo: `labs-newfeedby` (`src/stores/authStore.ts`, `src/lib/tokenStorage.ts`).**
Store persistido con user + tokens, mirror a localStorage para que el
interceptor de axios los lea.

- El store deja de guardar tokens: eso es del SDK. Guarda solo estado de UI.
- `tokenStorage` → `createWebStorage()`. Tus claves versionadas (`:v1`) fueron
  buena idea; el SDK usa una sola clave, así que si necesitás forzar un
  sign-out global, cambiá el nombre de la clave.
- El interceptor de axios → `auth.createFetch()`, o dejá axios y usá
  `auth.getAccessToken()` en el interceptor.
- `register()` de feedby devolvía tokens (auto-login). **Eso ya se puede**:
  aprovisioná la app con `require_email_verification: false` y `register()`
  persiste los tokens y emite `signed_in`. Con la verificación activa, el flujo
  es registro → "revisá tu correo" → login.

## Patrón D — JWT propio + localStorage

**Ejemplo: `workspace-henri/henri-dashboard` (`src/lib/api/`).** Es el que más
se parece a Gateward: access+refresh en localStorage, refresh single-flight,
cookie marcadora, bus de forced-logout.

Casi todo se borra porque el SDK ya lo trae:

| Archivo de henri | Reemplazo |
|---|---|
| `tokenStore.ts` | `withSessionMarker(createWebStorage())` |
| `authEvents.ts` | `onAuthStateChange()` |
| `client.ts` (middleware de refresh) | `auth.createFetch()` |
| `AuthProvider.tsx` | `<GatewardProvider>` |
| cookie `henri.authed` | `SESSION_MARKER_COOKIE` |

`whoami()` → `getUser()`. El chequeo `user_type !== 'admin'` pasa a
`membership_role`/`metadata`.

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

**Si tu backend es Python** (skysset con Django/DRF, feedby con FastAPI, henri
con Django) todavía no hay SDK. Opciones: verificar a mano con `PyJWT` +
`PyJWKClient` contra `/.well-known/jwks.json` (ES256), o esperar al SDK de
Python.

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

No hay import masivo. Los hashes viejos (bcrypt de Convex, Argon2 de Django) no
se pueden trasladar: Gateward usa Argon2id con sus propios parámetros y no
acepta hashes ajenos.

Dos caminos:

1. **Reset forzado.** Registrás los emails y mandás `forgotPassword()` a todos.
   Simple, cuesta una campaña de correo.
2. **Migración perezosa.** Mantenés el login viejo un tiempo; en cada login
   exitoso, registrás al usuario en Gateward con la contraseña que acaba de
   escribir en claro. Sin fricción para el usuario, pero convivís con dos
   sistemas hasta que la cola se vacíe.

## Bloqueadores conocidos

Cosas que hoy **no** se pueden migrar tal cual:

| Bloqueador | A quién afecta |
|---|---|
| `register` no acepta perfil (nombre) en el alta | tennispro, feedby, ligamx |
| Sin cambio de email (EMAIL-CHANGE-001) | tennispro |
| Sin SDK de Python | skysset, feedby, henri (backends) |

Resueltos: APP-POLICY-001 (política de password por app — el PIN de 4 dígitos
de ligamx/mundialito ya entra — y auto-login en el alta) y ROLE-001
(`app_admin` ya es asignable; ver "Roles de app" en el README).

Están reportados al equipo del Core.
