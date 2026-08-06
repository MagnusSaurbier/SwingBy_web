# T-03 · ATLAS — Levels: loading, validation, solvability CI

**Area:** `packages/core` · **Depends on:** T-01 KEPLER *(interface only)* · **Blocks:** T-11 DRAFT

## Goal

Bring all 33 built-in levels across intact, define the persisted↔runtime boundary, and build the
harness that catches it when a physics change quietly breaks a level.

## Owned files

```
packages/core/src/level.ts
packages/core/src/levels.json
packages/core/test/level.test.ts
packages/core/test/solvability/**
```

## Reference

`reference/godot/data/levels_builtin.json` — 33 levels, already plain JSON. **Copy it verbatim.** Do not
reformat, reorder, or "clean up" the schema; it round-trips with the Godot editor and the desktop
game, and divergence means custom levels stop being portable between them.

Shape:

```json
{
  "name": "Orbital Primer",
  "author": "SwingBy",
  "goal": { "index": 2, "range": 64 },
  "objects": [
    { "type": "player", "x": 720, "y": 300, "boost_type": 1, "x_vel": 1.22, "y_vel": -0.44, "gravity": 0 },
    { "type": "sun",    "x": 960, "y": 508, "gravity": 1050, "visible": true, "size": 18 },
    { "type": "planet", "x": 1360, "y": 508, "x_vel": 0, "y_vel": 0, "gravity": 60, "size": 10, "anchored": true }
  ]
}
```

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#corelevelts--t-03-atlas).

## Defaults on hydrate

The JSON omits fields freely. Fill exactly these, matching Godot's `.get(key, default)` calls:

| Field | Default | Notes |
|---|---|---|
| `x_vel`, `y_vel` | `0` | |
| `size` | `10.0` | `DEFAULT_BODY_SIZE` — feeds the softening radius, so this matters to physics |
| `visible` | `true` | |
| `anchored` | `false` | |
| `turn_speed` | see below | visual only |
| `boost_type` | `0` | player only |

`angle`, `xAcc`, `yAcc`, `isBoosting`, `isBraking` initialise to `0`/`false`.

### `turn_speed` needs a decision

Godot does **not** default this to zero. `GameWorld._create_runtime_object` assigns
`randf_range(-3.0, -2.0)` — a fresh random spin rate per planet on every load. It is visual only
(it drives `body.angle`, which no force calculation reads), so it cannot affect solvability.

Defaulting to `0` is therefore safe but a visible regression: planets stop spinning. Options, in
preference order:

1. **Deterministic pseudo-spin** — derive from the body's index, e.g. `-2.0 - (index * 0.37 % 1.0)`.
   Keeps the look, stays reproducible, no schema change.
2. Fixed `-2.5` for all planets. Simplest; slightly more uniform than the original.
3. Literal `0`. Only if the spin turns out not to be visible at gameplay zoom.

Pick one, write it in the code comment, and tell T-04 AURORA which. Do **not** call `Math.random()` —
`packages/core` is deterministic by contract, and this is exactly the kind of small leak that makes
replay verification mysteriously fail months later.

## Validation

- Exactly one `player` object.
- `goal.index` within `objects`, and not the player.
- `goal.range > 0`.
- All coordinates, velocities, gravity, size finite (reject `NaN`, `Infinity`).
- At least one body with `gravity > 0` — a level with no gravity source is not a SwingBy level.

Return all errors at once, not just the first; T-11 DRAFT surfaces them in the editor.

## Solvability harness

The 33 levels were hand-verified against the Godot physics. Any change to `physics.ts` — including
the `Math.pow` fix in T-01 — can silently render one unsolvable, and nobody finds out until a player
gets stuck.

Build a CI check that, for each level, replays a **known-good input tape** and asserts the goal is
reached. Producing those tapes is part of this task: play each level (or script an approximate
solution) and record the tape via T-02's `TapeRecorder`. Commit them under
`test/solvability/tapes/`.

This harness is the safety net for the whole project. Treat a red run as a release blocker.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `hydrate`, `serialize`, `validate`, `levelId`, `BUILTIN_LEVELS` | `packages/core/src/level.ts` |
| 2 | Level data, byte-identical to the Godot original | `packages/core/src/levels.json` |
| 3 | Unit tests: defaults, validation, round-trip | `packages/core/test/level.test.ts` |
| 4 | One known-good solvability tape per level (33) | `packages/core/test/solvability/tapes/*.json` |
| 5 | Solvability runner, CI-wired | `packages/core/test/solvability/run.test.ts` |
| 6 | The `turn_speed` decision, recorded in code comments | — |

## Definition of done

- [ ] `BUILTIN_LEVELS.length === 33`, all passing `validate()`
- [ ] `serialize(hydrate(l))` deep-equals `l` for all 33 — exact round-trip
- [ ] `levels.json` is byte-identical to the Godot original (`diff` clean)
- [ ] Malformed levels return **all** applicable errors, never throw raw
- [ ] A solvability tape exists for every one of the 33 levels and all pass
- [ ] `turn_speed` decision made, documented, and **no `Math.random()` anywhere**
- [ ] Zero dependencies
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Note on level ids

Godot keys scores by level *index*. Indices break the moment a level is inserted. Define `levelId()`
as a stable string (`"builtin-01"`, or a slug of the name) and use it everywhere — scores, URLs,
leaderboards. Document the mapping from Godot's index-based `score_key` so existing local bests can
be migrated by T-10 VAULT.

## How to verify

**1. The level data is untouched** — this must be exact, not equivalent:

```bash
diff packages/core/src/levels.json \
     reference/godot/data/levels_builtin.json
```

**2. Unit and round-trip tests:**

```bash
npm test -w @swingby/core -- level
npm run typecheck
```

**3. Solvability — the gate that matters:**

```bash
npm test -w @swingby/core -- solvability
```

All 33 must reach the goal. Report which levels have the least margin; those are the ones a future
physics change will break first.

**4. Prove the harness bites.** Perturb one level's ship velocity by 5% on a scratch branch and
confirm the solvability run goes red. A green suite that cannot fail is not a safety net.

```bash
grep -rn "Math.random" packages/core/src/    # must be empty
```
