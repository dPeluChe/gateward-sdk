# Publicar una versión

`@gateward/sdk` se publica en npm público, bajo MIT, con
[provenance](https://docs.npmjs.com/generating-provenance-statements) — npm
firma el paquete con la identidad del workflow, así cualquiera puede verificar
que salió de este repo y no de la laptop de alguien.

## Qué versiona el SDK

**Su propia API, no la del Core.** El Core tiene su ciclo aparte.

| Cambio | Bump |
|---|---|
| Endpoint nuevo del Core expuesto como método nuevo | `minor` |
| Campo nuevo en un tipo de respuesta | `minor` |
| Cambia la firma de un método existente | `major` |
| Un campo desaparece del contrato | `major` |
| Arreglo sin cambiar la API | `patch` |

Regenerar tipos (`pnpm gen:contract`) **no** es de por sí un release: lo que
cuenta es si la superficie pública cambió. `pnpm typecheck` es el que avisa —
ya cazó una vez que el contrato traía `user_id`/`membership_role` donde el SDK
asumía `id`/`role`.

Antes de 1.0.0 (`0.x`), un `minor` puede romper. Al llegar a 1.0.0 aplica SemVer
estricto.

## Primer release

Una sola vez, antes del primer tag:

1. Crear la org `gateward` en npm y agregar a quien vaya a publicar.
2. Generar un **Automation token** (Access Tokens → Generate → Automation) y
   guardarlo como secret `NPM_TOKEN` del repo.
3. Verificar que `pnpm build` deja un `dist/` completo — es lo único que se
   publica, junto con README, LICENSE y CHANGELOG.

Un dry run sin publicar nada:

```bash
pnpm publish --dry-run --no-git-checks
```

Revisá la lista de archivos que imprime: no debe aparecer `src/`, `test/`, ni
`openapi.json`.

## Cada release

```bash
# 1. Mover lo de [Unreleased] a su versión en CHANGELOG.md, con fecha.
# 2. Subir la versión (sin tag: lo crea el paso siguiente a mano).
pnpm version 0.2.0 --no-git-tag-version

# 3. Commit + PR + merge.
git commit -am "release: 0.2.0"

# 4. Ya en main, tag y push.
git tag v0.2.0 && git push origin v0.2.0
```

El tag dispara `.github/workflows/release.yml`, que **falla antes de tocar npm**
si el tag no coincide con `package.json`, y luego corre typecheck, tests y build
antes de publicar.

## Si algo sale mal

npm no permite despublicar después de 72 horas, y ni siquiera dentro de ese
plazo si alguien ya depende del paquete. La salida real es publicar un `patch`
que arregle, y marcar la versión mala:

```bash
npm deprecate @gateward/sdk@0.2.0 "rota: usar 0.2.1"
```

Por eso el workflow corre toda la suite antes de publicar, y por eso el primer
`npm publish` lo hace una persona, no un bot.
