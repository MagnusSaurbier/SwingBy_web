# SwingBy Web

Browser port of SwingBy, an orbital-mechanics puzzle game, to be hosted at
`swingby.magnussaurbier.de`.

**Status:** planning complete, implementation not started.

---

## Read these first

| Document | What it is |
|---|---|
| [PROJECT.md](PROJECT.md) | What the game is, what we're building, architecture, conventions. **Every agent reads this first.** |
| [INTERFACES.md](INTERFACES.md) | Frozen contracts between tasks, and the file-ownership table. |
| [DESIGN.md](DESIGN.md) | Scope, infrastructure, and the reasoning behind the decisions. |

Already written and **frozen** — the shared vocabulary, do not edit:

- [`packages/core/src/types.ts`](packages/core/src/types.ts)
- [`packages/core/src/constants.ts`](packages/core/src/constants.ts)

## Tasks

Each is self-contained, owns a disjoint set of files, and codes against interfaces rather than
implementations. No two tasks write the same file.

| ID | Name | Task | Depends on | Start now? |
|---|---|---|---|---|
| T-01 | [**KEPLER**](tasks/T-01-KEPLER.md) | Physics core + Godot parity harness | — | ✅ **start first** |
| T-02 | [**TAPE**](tasks/T-02-TAPE.md) | Replay encoding + verification | T-01 iface | ✅ |
| T-03 | [**ATLAS**](tasks/T-03-ATLAS.md) | Levels, validation, solvability CI | T-01 iface | ✅ |
| T-04 | [**AURORA**](tasks/T-04-AURORA.md) | Canvas renderer | — | ✅ |
| T-05 | [**FLYWHEEL**](tasks/T-05-FLYWHEEL.md) | Game loop, camera, bounds, win | ifaces | ✅ |
| T-06 | [**HELM**](tasks/T-06-HELM.md) | Keyboard, touch, gamepad, rebinding | — | ✅ |
| T-07 | [**CHORUS**](tasks/T-07-CHORUS.md) | Procedural WebAudio | — | ✅ |
| T-08 | [**BRIDGE**](tasks/T-08-BRIDGE.md) | UI shell: menu, level select, settings | T-10 iface | ✅ |
| T-09 | [**GAUGE**](tasks/T-09-GAUGE.md) | HUD, pause, completion, toasts | T-05 iface | ✅ |
| T-10 | [**VAULT**](tasks/T-10-VAULT.md) | Local persistence | — | ✅ |
| T-11 | [**DRAFT**](tasks/T-11-DRAFT.md) | Level editor | T-03/04/05 ifaces | after ifaces settle |
| T-12 | [**LEDGER**](tasks/T-12-LEDGER.md) | Backend API + schema | T-02 iface | ✅ |
| T-13 | [**PODIUM**](tasks/T-13-PODIUM.md) | Leaderboard + sharing client | T-12 iface | ✅ |
| T-14 | [**LAUNCHPAD**](tasks/T-14-LAUNCHPAD.md) | Vercel deploy, routing, CI | — | ✅ |

Because every dependency is interface-only and the interfaces are already frozen, **thirteen of the
fourteen tasks can start immediately.** T-11 DRAFT is the one worth holding until T-03/04/05 have
settled in practice.

**Critical path:** T-01 KEPLER → T-05 FLYWHEEL → T-09 GAUGE.

**Highest risk:** T-01 KEPLER. Physics parity is the one thing that cannot be patched up later —
if the simulation is subtly wrong, some of the predefined levels become unsolvable and nobody
finds out until a player is stuck. It is also the smallest task by line count. Start it first and
finish it properly.

Every task document ends with three sections that define completion:

- **Deliverables** — the concrete artifacts, with their paths
- **Definition of done** — a checklist, plus the global one in [PROJECT.md §7](PROJECT.md#7-definition-of-done-globally)
- **How to verify** — the actual commands and manual steps, including how to prove your own tests
  can fail

Shared build commands are contracted in [PROJECT.md §6](PROJECT.md#6-toolchain-contract). T-14
LAUNCHPAD ships them under exactly those names; no task invents its own.

## Working agreement

1. Read [PROJECT.md](PROJECT.md) and [INTERFACES.md](INTERFACES.md) before writing code.
2. Write only files your task owns (table in INTERFACES.md).
3. Code against interfaces. Do not read another task's implementation, and do not wait for it —
   stub it. Every task document explains how to work standalone.
4. If an interface is wrong, say so and change INTERFACES.md deliberately, notifying consumers.
   Never work around it locally or diverge silently.
5. `packages/core` stays dependency-free and browser-free. It runs in node too — that is what makes
   server-side score verification possible.
6. Never use `Math.pow` in the physics path. See PROJECT.md §4.

## Source material

| Path | Role |
|---|---|
| `reference/godot/` | **Reference implementation.** Godot 4.6. All behaviour comes from here. |
| `reference/swift/` | Swift/SpriteKit rewrite, 5 levels, different physics. **Not a reference**, except `AudioManager.swift` for T-07. |
| _(not included)_ | Python original. Historical only. |

## Open items

Tracked in [DESIGN.md](DESIGN.md) §9. Two need answers before launch, neither blocks development:

- **svgrepo icon licensing** — T-08 BRIDGE replaces them rather than resolving it.
- **The Hetzner box** ("23x") — unidentified. Not needed for this scope; only realtime multiplayer
  would change that.
