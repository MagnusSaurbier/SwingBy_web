# SwingBy Web — the game

_Read this when your task touches gameplay, mechanics, level content, or general repo conventions.
See [docs/INTERFACES.md](INTERFACES.md) for exact type/function contracts and
[docs/PHYSICS.md](PHYSICS.md) for the physics in mathematical detail._

## 1. What the game is

SwingBy is a single-player 2D orbital-mechanics puzzle. You pilot a spacecraft through a miniature
solar system and reach a target body using gravity, an initial launch velocity, and two in-flight
controls.

The ship has exactly two effective inputs: **boost**, which increases speed along the current
heading, and **brake**, which decreases it. Neither changes heading. All steering comes from
gravity — you cannot point the ship, so you must read the gravity field and intervene at the right
moments.

Suns are heavy and usually stationary. Planets orbit freely or are **anchored** in place. Some suns
are **invisible**: they exert full gravity but are not drawn, so the player must infer them from how
the trajectory bends. Reaching the goal means entering a capture radius around a designated body.
Flying too far out of bounds triggers a warning and then an automatic reset. There are no lives, no
enemies, and no time limit — you restart freely and chase two scores per level: **fastest time** and
**least boost used** (the efficiency metric).

Planning aids the player can toggle: a **trajectory prediction** that forward-simulates the next
~7 seconds assuming no input, a **trail** showing the actual flown path, and a **force vector**
showing net gravitational pull. The camera auto-zooms to keep the ship framed.

Beyond the 33 built-in levels there is a **level editor** for authoring custom systems, and a
**workshop** for picking one of four rocket appearances.

## 2. What this is

A browser build hosted at `swingby.magnussaurbier.de`:

- **Light.** Target under 250 KB gzipped, instant load, no WASM blob. This is a personal site, not a
  game portal.
- **Playable on a phone.** Touch controls are first-class.
- **Online-augmented.** Global leaderboards with server-verified scores, and shareable custom levels.

## 3. Architecture

```
SwingBy_web/
  packages/
    core/          Pure TypeScript. Zero dependencies. Runs in browser AND node.
      src/
        types.ts       shared type contract
        constants.ts   simulation + gameplay constants
        physics.ts     physics core — see docs/PHYSICS.md
        replay.ts       input-tape encode/decode/verify
        level.ts        level loading, validation, hydrate/serialize
        levels.json     the 33 built-in levels
    web/           Browser app.
      src/
        render/         canvas renderer
        game/           loop, camera, bounds, input, audio
        ui/             menu, level select, settings, workshop
        hud/            in-game HUD, pause, toasts
        storage/        local persistence
        editor/         level editor
        net/            leaderboard + sharing client
  api/             Vercel serverless functions (leaderboard, level sharing)
  infra/           deploy config, CI, ops tooling — see infra/DEPLOY.md, infra/AUTOMATION.md
```

`packages/core` is the critical boundary. It is the _same code_ the browser runs and the server
replays for score verification — no second implementation, so no drift between what the player
experienced and what the server validates. It must never import a browser or node API.

## 4. Conventions

**Language.** TypeScript, strict mode. No `any` in `packages/core`.

**Numerics.** `packages/core` uses only `+ - * / Math.sqrt`, all correctly rounded under IEEE 754,
so client and server agree bit-for-bit. **Never use `Math.pow` in the physics path** — it is not
required to be correctly rounded and diverges across engine versions. Write `x * Math.sqrt(x)` for
`x^1.5`, which is exactly equal and reproducible.

**Coordinates.** World space is the level JSON's space: +x right, +y **down**. Levels span roughly
0–2600 × 0–1800. Do not flip the axis; the levels are authored in it and flipping breaks every
`turn_speed` and orbit direction.

**Naming.** Persisted JSON stays `snake_case` (it must round-trip with existing files). Runtime code
is `camelCase`. `hydrate()` / `serialize()` in `level.ts` are the only conversion points.

**Units.** Simulation runs in ticks at 144 Hz. Store durations as integer tick counts internally;
convert to ms only at display and API boundaries. Never accumulate wall-clock time into the sim.

**Determinism.** Physics never reads wall-clock time, `Math.random`, or anything outside the passed
state. Rendering and audio may do whatever they like — they are outside the contract.

**No premature framework.** The renderer is imperative canvas code. The UI layer may use a small
framework or plain DOM; that decision must not leak into `core`, `render`, or `game`.

## 5. Toolchain

| Command                         | Does                                            |
| ------------------------------- | ----------------------------------------------- |
| `npm run typecheck`             | `tsc --strict` across every workspace           |
| `npm test`                      | All tests, all packages                         |
| `npm test -w @swingby/core`     | One package's tests                             |
| `npm run dev -w @swingby/web`   | Dev server on `localhost:5173`                  |
| `npm run build -w @swingby/web` | Production build                                |
| `npm run size`                  | Bundle budget check — fails over 250 KB gzipped |
| `npm run lint`                  | Formatting and lint                             |

Workspaces are `@swingby/core`, `@swingby/web`, `@swingby/api`. Node 22+ is what CI runs against
(see `.github/workflows/ci.yml`); pnpm is not used — do not add it.

## 6. Definition of done, for any change

- [ ] `npm run typecheck` clean — no `any` in `packages/core`, no `@ts-expect-error` left behind
- [ ] `npm test` green
- [ ] No new runtime dependency in `packages/core` — it stays zero-dependency
- [ ] Anything you measured is reported as a number, not an adjective ("3.1 ms", not "fast")
- [ ] If your change adds or changes an architectural fact, a type contract, or a physics equation,
      the relevant file under `docs/` is updated in the same commit — see AGENTS.md
