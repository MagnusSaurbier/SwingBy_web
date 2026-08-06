# SwingBy Web — Project Description

*Companion to [DESIGN.md](DESIGN.md) (scope, infrastructure, rationale) and
[INTERFACES.md](INTERFACES.md) (frozen contracts). This document is the shared briefing every task
agent reads first.*

---

## 1. What the game is

SwingBy is a single-player 2D orbital-mechanics puzzle. You pilot a spacecraft through a miniature
solar system and reach a target body using gravity, an initial launch velocity, and two in-flight
controls.

The ship has exactly two effective inputs: **boost**, which increases speed along the current
heading, and **brake**, which decreases it. Neither changes heading. All steering comes from
gravity. That constraint is the entire game — you cannot point the ship, so you must read the
gravity field and intervene at the right moments.

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

## 2. What we are building

A browser version, hosted at `swingby.magnussaurbier.de`, that is:

- **Faithful.** Same physics, same 33 levels, same feel. Trajectories must match the Godot original
  to within tight tolerance — the levels were hand-verified solvable against those exact numbers.
- **Light.** Target under 250 KB gzipped, instant load, no WASM blob. This is a personal site, not a
  game portal; a 30 MB download would be absurd next to a CV page.
- **Playable on a phone.** Touch controls are a first-class requirement, not a port afterthought.
- **Online-augmented.** Global leaderboards with server-verified scores, and shareable custom levels.

### Source of truth

[`reference/godot/`](reference/) — a snapshot of the Godot 4.6 project (`MagnusSaurbier/SwingBy2026`
at `dd2b501`), ~5,600 lines across 11 modules. **This is the reference implementation for all
behaviour**, and it is checked into this repo so agents working in isolated containers can read it.
See [reference/README.md](reference/README.md) for the rules — read-only, never imported.

Two other projects exist and are **not** references:

- `SwingBy2022` — Python/Pygame original from 2022. Historical, not included.
- `SwingBy` — a Swift/SpriteKit rewrite from April 2026 with only 5 levels and different physics
  constants. Do not port from it. **One exception:** its `AudioManager.swift` (staged at
  `reference/swift/`) synthesizes all sound procedurally, and that approach is what T-07 CHORUS ports.

## 3. Architecture

```
SwingBy_web/
  packages/
    core/          Pure TypeScript. Zero dependencies. Runs in browser AND node.
      src/
        types.ts       FROZEN — shared type contract
        constants.ts   FROZEN — ported GameConstants.gd
        physics.ts     T-01 KEPLER
        replay.ts      T-02 TAPE
        level.ts       T-03 ATLAS
        levels.json    T-03 ATLAS (copied from SwingBy2026/data/)
    web/           Browser app.
      src/
        render/        T-04 AURORA
        game/          T-05 FLYWHEEL, T-06 HELM, T-07 CHORUS
        ui/            T-08 BRIDGE
        hud/           T-09 GAUGE
        storage/       T-10 VAULT
        editor/        T-11 DRAFT
        net/           T-13 PODIUM
  api/             T-12 LEDGER — Vercel serverless functions
  infra/           T-14 LAUNCHPAD — deploy config, CI
```

`packages/core` is the critical boundary. It is the *same code* the browser runs and the server
replays for score verification. No second implementation, so no drift between what the player
experienced and what the server validates. It must never import a browser or node API.

## 4. Conventions

**Language.** TypeScript, strict mode. No `any` in `packages/core`.

**Numerics.** `packages/core` uses only `+ - * / Math.sqrt`, all correctly rounded under IEEE 754,
so client and server agree bit-for-bit. **Never use `Math.pow` in the physics path** — it is not
required to be correctly rounded and diverges across engine versions. The Godot original computes
`pow(x, 1.5)`; write `x * Math.sqrt(x)`, which is exactly equal and reproducible. See DESIGN.md §6.

**Coordinates.** World space is the level JSON's space: +x right, +y **down** (Godot screen
convention). Levels span roughly 0–2600 × 0–1800. Do not flip the axis; the levels are authored in
it and flipping breaks every `turn_speed` and orbit direction.

**Naming.** Persisted JSON stays `snake_case` (it must round-trip with existing files). Runtime code
is `camelCase`. `hydrate()` / `serialize()` in `level.ts` are the only conversion points.

**Units.** Simulation runs in ticks at 144 Hz. Store durations as integer tick counts internally;
convert to ms only at display and API boundaries. Never accumulate wall-clock time into the sim.

**Determinism.** Physics never reads wall-clock time, `Math.random`, or anything outside the passed
state. Rendering and audio may do whatever they like — they are outside the contract.

**No premature framework.** The renderer is imperative canvas code. The UI layer may use Svelte or
plain DOM; that decision belongs to T-08 BRIDGE and must not leak into `core`, `render`, or `game`.

## 5. How parallel work is organised

Every task below owns a disjoint set of files. **No two tasks write the same file.** Anything shared
is either already frozen (`types.ts`, `constants.ts`) or is explicitly one task's deliverable that
others consume through the interface documented in [INTERFACES.md](INTERFACES.md).

Tasks code against interfaces, not implementations. If your task depends on T-01 KEPLER, you import
the signatures from `types.ts` and write against them — you do not wait for T-01 to finish, and you
do not read its source. If an interface turns out to be wrong, that is a change to INTERFACES.md and
a note to the affected owners, not a unilateral edit.

| ID | Name | Area | Depends on |
|---|---|---|---|
| T-01 | **KEPLER** | Physics core + Godot parity harness | — |
| T-02 | **TAPE** | Replay encoding + verification | T-01 (interface only) |
| T-03 | **ATLAS** | Level loading, validation, solvability CI | T-01 (interface only) |
| T-04 | **AURORA** | Canvas renderer | — |
| T-05 | **FLYWHEEL** | Game loop, camera, bounds, win condition | T-01, T-04 (interfaces) |
| T-06 | **HELM** | Keyboard, touch, gamepad input + rebinding | — |
| T-07 | **CHORUS** | Procedural WebAudio | — |
| T-08 | **BRIDGE** | UI shell: menu, level select, settings, workshop | T-10 (interface) |
| T-09 | **GAUGE** | In-game HUD, pause, level complete, toasts | T-05 (interface) |
| T-10 | **VAULT** | Local persistence | — |
| T-11 | **DRAFT** | Level editor | T-03, T-04, T-05 (interfaces) |
| T-12 | **LEDGER** | Backend API + schema | T-02 (interface) |
| T-13 | **PODIUM** | Leaderboard + sharing client | T-12 (interface) |
| T-14 | **LAUNCHPAD** | Vercel deploy, routing, CI | — |

Seven tasks have no dependencies at all and can start immediately: **KEPLER, AURORA, HELM, CHORUS,
VAULT, LAUNCHPAD**, and **ATLAS** (its physics dependency is interface-only).

**Critical path:** KEPLER → FLYWHEEL → GAUGE. KEPLER is also the highest-risk task, because parity
with the Godot original is the one thing that cannot be fudged later. Start it first.

## 6. Toolchain contract

T-14 LAUNCHPAD provides these scripts. Every task's verification steps assume them, so they are a
contract like any other — T-14 must ship exactly these names, and no task may invent its own.

| Command | Does |
|---|---|
| `npm run typecheck` | `tsc --strict` across every workspace |
| `npm test` | All tests, all packages |
| `npm test -w @swingby/core` | One package's tests |
| `npm run dev -w @swingby/web` | Dev server on `localhost:5173` |
| `npm run build -w @swingby/web` | Production build |
| `npm run size` | Bundle budget check — fails over 250 KB gzipped |
| `npm run lint` | Formatting and lint |

Workspaces are `@swingby/core`, `@swingby/web`, `@swingby/api`. Node 26.5.0 and npm 11.17.0 are what
is installed; **pnpm is not available** — do not add it.

Until T-14 lands, run files directly: `node --experimental-strip-types <file>.ts`.

## 7. Definition of done, globally

Every task has its own **Deliverables**, **Definition of done**, and **How to verify** sections.
Beyond those, a task is complete only when all of the following hold:

- [ ] `npm run typecheck` clean — no `any` in `packages/core`, no `@ts-expect-error` left behind
- [ ] `npm test` green, including other tasks' suites (you have not broken anyone)
- [ ] **No file outside your ownership row in [INTERFACES.md](INTERFACES.md) was modified.**
      Verify with `git diff --name-only` before opening a PR.
- [ ] No new runtime dependency in `packages/core` — it stays zero-dependency
- [ ] Interfaces you consumed are unchanged, or the change is recorded in INTERFACES.md and the
      affected task owners are named in the PR description
- [ ] Anything you measured is reported as a number, not an adjective ("3.1 ms", not "fast")
- [ ] UI work includes a screenshot; numeric work includes the measurements

If you could not meet a criterion, say so explicitly in the PR and explain why. A task reported as
done that is not done costs more than one reported as blocked.
