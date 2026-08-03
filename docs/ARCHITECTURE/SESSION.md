# Sesión: decisiones de diseño

Por qué el ciclo de sesión del SDK está armado así. La guía de uso está en el
[README](../../README.md); esto es el rationale que no cabe en un comentario.

Las decisiones salieron de auditar cómo resuelven login varias aplicaciones
reales antes de diseñar el SDK.

---

## `session_expired` separado de `signed_out`

`AuthSession` emite cuatro eventos: `signed_in`, `token_refreshed`,
`signed_out`, `session_expired`.

Los dos últimos podrían haber sido uno solo. No lo son porque las apps
reaccionan distinto:

- `signed_out` — el usuario pidió irse. Va al home, con calma.
- `session_expired` — el server tiró la sesión bajo los pies de la app (refresh
  token muerto o rotado). Hay que sacar al usuario de donde está, ya.

Antes de esto, un refresh token muerto limpiaba el storage **en silencio** y la
app seguía pintando una shell autenticada sobre una sesión que ya no existía.
Más de una app auditada había tenido que armarse su propio bus de forced-logout
justo para tapar eso.

Un fallo de refresh que **no** sea 401 no emite nada: la sesión puede seguir
siendo válida y no hay razón para tirarla por un 500 o un blip de red.

Un listener que tira error queda aislado, mismo criterio que los `hooks` de
observabilidad: instrumentar no puede romper el pipeline de tokens.

## Cache de `getUser()`

La identidad es estable mientras dure la sesión, así que `/v1/auth/me` se
cachea y las llamadas concurrentes comparten un solo request.

La invalidación no es simétrica a propósito:

| Evento | Cache |
|---|---|
| `signed_in` | se tira — puede ser **otro** usuario |
| `token_refreshed` | se conserva — mismo usuario, tokens nuevos |
| `signed_out` / `session_expired` | se tira |

## Claims sin verificar

`getClaims()` decodifica el access token sin round-trip y **sin verificar la
firma**. Es deliberado: el token sale del storage de este mismo cliente, así que
verificarlo contra el JWKS no prueba nada que no sepamos ya.

Sirve como pista de UI. Un backend que **recibe** un token de afuera lo verifica
con `GatewardServer.verifyToken`, que sí valida ES256 contra el JWKS.

## `createFetch()` y el alcance del token

`authedRequest()` solo pega contra el Core. Las apps también necesitan el token
en llamadas a **su propio** backend, y todas las auditadas habían escrito el
mismo interceptor a mano: middleware de openapi-fetch, interceptor de axios, o
pasar el token a mano en cada llamada.

Tres decisiones:

1. **Sin sesión pasa sin firmar, no tira.** Los endpoints públicos siguen
   andando y tu API responde su propio 401. Solo un 401 de `getAccessToken` se
   trata así — un fallo de red o un 5xx durante el refresh sí propaga, porque
   eso no significa "no estoy logueado".
2. **Si el refresh falla, se devuelve el 401 original de tu API.** Enmascararlo
   con el error del refresh esconde por qué falló la llamada de verdad.
3. **`origins` acota a qué hosts se manda el token.** Sin lista se firma todo lo
   que pase por ese `fetch`. Correcto si se lo das a un solo cliente de API;
   peligroso como reemplazo global de `fetch`, donde estarías mandando tu access
   token a terceros.

Un `Request` como input se clona antes de firmar, para que el reintento pueda
reproducir su body — `openapi-fetch` llama `fetch(request)`, no
`fetch(url, init)`.

## Cookie marcadora para SSR

Los tokens viven en Web Storage, que el server nunca ve. Sin ayuda, un framework
SSR no distingue un request logueado de uno que no, y toda ruta protegida
renderiza una shell que redirige desde el cliente. Varias apps Next auditadas ya
se habían inventado una cookie marcadora propia para esto.

`withSessionMarker()` mantiene una cookie **no secreta** pegada al ciclo de
tokens: se escribe en cada `set`, se borra en cada `clear`. Una sesión expirada
limpia su propio marcador sin que la app haga nada.

> **No es autenticación.** Es una optimización de render: decide si el server se
> molesta en pintar el layout autenticado. La cookie es falsificable y no
> contiene credencial, así que falsificarla solo consigue una shell vacía — toda
> llamada a datos sigue necesitando un token real y responde 401 sin él.

Tres detalles que muerden, cada uno con test:

- `clear()` escribe el nombre con valor vacío. Leer eso como "logueado" dejaría
  a un usuario deslogueado varado en una shell que no puede cargar nada.
- Los prefijos de `protect` matchean por segmento: `/dashboard` protege
  `/dashboard/x` pero nunca `/dashboard-public`.
- El `?next=` es path+query, jamás una URL absoluta, o la pantalla de login se
  vuelve un open redirect.

`@gateward/sdk/next` no importa nada de `next`: habla solo `Request`/`Response`
estándar, así que el mismo helper sirve en Remix, SvelteKit o Hono. Se llama
`/next` porque es donde la gente lo va a buscar.

## Sync entre pestañas

`TokenStorage` tiene un `subscribe` opcional. `createWebStorage()` lo implementa
con el evento `storage` del browser, que dispara **solo en las otras pestañas** —
no hay auto-eco que filtrar.

El mapeo a eventos de sesión usa `oldValue`/`newValue` del evento:

| Transición | Evento |
|---|---|
| algo → nada | `signed_out` |
| nada → algo | `signed_in` |
| refresh token distinto | `token_refreshed` |
| mismo par reescrito | nada |

Distinguir el refresh del login importa: si un refresh de otra pestaña emitiera
`signed_in`, cada pestaña abierta re-consultaría `/v1/auth/me` cada 15 minutos
sin necesidad.

Está prendido por default (`syncTabs: false` para apagarlo). Un logout que no se
propaga es una sorpresa desagradable, no una optimización opcional.

`withSessionMarker()` reenvía el `subscribe` del storage que envuelve — sin eso,
envolverlo desactivaría el sync en silencio, y las dos cosas están pensadas para
usarse juntas.

## Bootstrap del provider de React

`status` arranca en `loading`, no en `unauthenticated`. Tratar "todavía no hay
user" como "deslogueado" hace parpadear la pantalla de login en cada reload
mientras `/v1/auth/me` está en vuelo. Es el mismo `AuthStatus` de tres estados
que las apps auditadas ya modelaban a mano.

Un 401 en el bootstrap es el camino normal de "no hay sesión" y no llena
`error`. Cualquier **otro** fallo (500, red) sí se registra y no se disfraza de
"deslogueado" — si no, un blip del backend manda una sesión perfectamente válida
a `/login`.

`onSessionExpired` corre solo cuando el server tira la sesión, nunca en un
`logout()` explícito, así que una app que hace hard redirect ahí no navega dos
veces.
