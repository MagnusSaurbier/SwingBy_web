# T-03 ATLAS — thought log

## 2026-08-13T09:47Z — backfill: reading + design decisions before this point

Read README.md, PROJECT.md, INTERFACES.md, tasks/T-03-ATLAS.md, types.ts, constants.ts (frozen),
`reference/godot/data/levels_builtin.json`, `reference/godot/scripts/GameWorld.gd`,
`reference/godot/scripts/DataManager.gd`. Did NOT read physics.ts (doesn't exist yet — T-01 not
landed) or replay.ts (doesn't exist yet — T-02 not landed). Confirmed via Glob before relying on
their absence.

**Orchestrator's instructions override the task doc's file paths.** tasks/T-03-ATLAS.md says test
files go at `packages/core/test/level.test.ts` and `packages/core/test/solvability/**`. The
orchestrator's message (this session) instead says: only write under
`packages/core/test/level/**`, and explicitly stay out of `test/parity/**` (T-01's). I followed the
orchestrator: `packages/core/test/level/level.test.ts` and
`packages/core/test/level/solvability/**`. Recording this in case a future reader diffs against the
task doc and wonders why the paths don't match — this was deliberate, not an oversight.

### levels_builtin.json field-presence census (the load-bearing discovery)

Ran a script over all 33 levels / ~154 objects to find, per BodyType, which optional fields are
*ever* present vs absent, and what values they take when present. This is the finding that made an
exact `serialize(hydrate(l)) === l` round-trip tractable — it is NOT "omit field if it equals the
default", it's "field presence is conditioned on body type, not on value". Full table:

- **player**: `x_vel`, `y_vel`, `boost_type`, `gravity` — always present (33/33). `size`,
  `visible`, `anchored`, `turn_speed` — always absent (0/33).
- **sun**: `size`, `visible`, `gravity` — always present (48/48). `x_vel`, `y_vel`, `anchored`,
  `turn_speed`, `boost_type` — always absent (0/48).
- **planet**: `x_vel`, `y_vel`, `size`, `gravity` — always present (59/59). `anchored` — present
  only twice, both `true` (57/59 absent, defaulting false). `visible`, `turn_speed`, `boost_type` —
  always absent (0/59).

Critically: **planet `size` does include the value 10 explicitly** (e.g. Orbital Primer's anchored
planet, object index 2) — so "omit size if === DEFAULT_BODY_SIZE(10)" as a *value-based* rule would
have wrongly dropped it for planets/suns. Only `player.size` is safe to omit-by-value, because it's
the only type/field combo where the field is *always* absent in the source data (so it always
hydrates to exactly the default, and re-emitting only on divergence never fires for the real 33).
Same logic: sun.visible is ALWAYS explicit (both true and false values occur, e.g. Orbital Primer sun
visible:true, Hidden Pull sun visible:false) — so a naive "omit if === true (the default)" rule
would break Orbital Primer's round-trip. Sun visible must be **type-gated always-emit**, not
value-gated.

Decision: `serializeObject()` uses a *hybrid* per-field rule — type-gated for x_vel/y_vel/size/
visible/boost_type (mirrors which type the source data ever attaches the field to), value-gated only
for anchored (omit iff `=== false`) and turn_speed (omit iff `=== the synthetic default for that
index`), because those two are the only fields where the source data's presence actually correlates
with a non-default value rather than with type. Verified this reproduces the dataset with a census
script before writing any serialize code — did not just theorize it.

### turn_speed decision (task doc option 1, chosen)

`GameWorld._create_runtime_object` (GameWorld.gd:630) assigns `randf_range(-3.0, -2.0)` to
`turn_speed` for literally every object type, every load. Visual-only (feeds `body.angle`, no force
calc reads it). Chose **deterministic pseudo-spin from object index**:
`turnSpeed = -2.0 - ((index * 0.37) % 1.0)`, lands in the same (-3,-2] band, zero randomness. `index`
is the object's position in `Level.objects` (0-based, whole array, not per-type/per-planet index) —
picked this because it's the simplest unambiguous reading of "the body's index" and requires no
extra bookkeeping.

### size default: 10 for ALL types, not Godot's per-type default — deliberate divergence, documented

`GameWorld._create_runtime_object` (GameWorld.gd:614-619) actually defaults size per type: sun=18,
player=12, planet=10 (`DEFAULT_BODY_SIZE` in constants.ts is 10, matching only the planet case).
But: (a) types.ts's own frozen doc comment on `Body.size` says "Defaults to 10 when absent" with no
per-type carve-out, (b) the task doc's defaults table says flatly `size | 10.0`, and (c) empirically
only `player` objects ever omit size in the real data (sun/planet always specify it explicitly) — so
this divergence from Godot's per-type default only ever touches the player's own softening radius,
never a sun or planet's. Went with the frozen-contract reading (10 for every type) rather than
Godot's actual per-type runtime default, since types.ts is frozen and explicit. Documented this
explicitly in a code comment on `hydrate()` so nobody "fixes" it into a Godot-matching per-type
default later without knowing it was a deliberate reading of the frozen spec.

### boost_type: raw pass-through, not clamped, not offset — deliberate

Reference data stores player `boost_type` as 1-4 (not 0-3). Investigated why: Godot's
`_create_runtime_object` (GameWorld.gd:609-613) for `type == "player"` **ignores the raw_data
boost_type field entirely** and instead reads `DataManager.settings.get("boost_type", 0)` (the
user's equipped rocket skin from Settings, 0-3) — the persisted field is a vestige of
`editor_export_level` (GameWorld.gd:370: `exported["boost_type"] = int(obj["boost_type"]) + 1`),
never read back for gameplay. Since `packages/core` has no Settings concept and `hydrate()` takes
only a `Level`, there's no equivalent override available here anyway. Decision: `hydrate()` copies
`boost_type` straight through (`?? 0` only when absent), no clamping to 0-3, no -1 offset — required
for round-trip fidelity (clamping would corrupt 1→1, 2→2, 3→3, 4→4 into wrong values on the way
back out) — documented as a deliberate discrepancy from the "0-3" range noted in types.ts's
LevelObject.boost_type comment, since that comment describes intent, not what the actual stored data
does.

### JSON import into a zero-`resolveJsonModule` tsconfig — dead end ruled out, then a working path found

Root `tsconfig.json` has no `resolveJsonModule`, and I cannot edit it (out of ownership — only
level.ts + levels.json + my tests). Tried `declare module "*.json"` wildcard ambient declaration
*inside* level.ts itself to unblock `import ... from "./levels.json"` without the flag — **dead
end**: TS treats a `declare module` block inside a file that itself has top-level import/export as a
*module augmentation* (needs the module to already resolve), not a fresh ambient/wildcard
declaration; wildcard declarations only work from a global-script `.d.ts` file, which I'm not allowed
to add. Got `TS2664: Invalid module name in augmentation, module '*.json' cannot be found.` — proved
this empirically in a scratch dir before giving up on it.

**What actually works**: `import levelsData from "./levels.json" with { type: "json" };` (the ES2025
import-attributes syntax) compiles clean under this exact tsconfig with NO resolveJsonModule and NO
ambient declaration — TS has a separate code path for import-attribute JSON imports that doesn't
gate on that flag. Verified empirically: tsc infers the real literal structural type (proved via a
`@ts-expect-error` probe assigning to the wrong type), and a direct `data as readonly Level[]`
assertion compiles (allowed because TS's cast-direction rule permits it: `Level`'s literal-union
fields are assignable *into* the JSON-inferred widened-`string` shape, satisfying the "either
direction assignable" requirement for `as`). Also confirmed the same import line runs correctly
under plain `node file.mjs` (Node 22, static AND dynameport import) and under `vitest run`
(esbuild-based transform) — tested all three toolchains before committing to this approach in the
real file. This is now what `packages/core/src/level.ts` uses to import `levels.json`; no new files,
no tsconfig edit needed.

### Solvability harness: cannot produce actually-verified tapes today — by design, not a shortcut

Confirmed via Glob: neither `packages/core/src/physics.ts` (T-01) nor `packages/core/src/replay.ts`
(T-02) exist in this checkout. Orbital mechanics puzzles here are fundamentally not hand-solvable by
static reasoning — boost/brake only *rescale speed along the current heading*, they cannot steer;
all steering comes from gravity bending the path over time, which requires actually integrating the
simulation to know if a candidate input tape reaches the goal. Reimplementing physics myself to
verify tapes was considered and rejected — that's T-01's exclusive file, doing so risks exactly the
"second implementation drifts from the first" failure PROJECT.md warns about, and I was explicitly
told not to read/import physics.ts or wait for it.

Decision: build the full harness now (dynamic-import adapter matching the frozen `simulateTick`
signature, a runner that replays a tape tick-by-tick and asserts `reachedGoal`), and ship all 33
tape files as **honestly-labeled placeholders** — pure `NO_INPUT` coast, `{ ticks: 1440, boost: [],
brake: [] }`, generous 10s horizon — NOT claimed as verified solutions. When physics.ts is absent
(true today), the runner detects it via a failed dynamic import and skips every per-level test
*loudly* (vitest "skipped" status, plus a console banner), rather than reporting a false green. This
matches the orchestrator's explicit instruction ("skip loudly rather than pass vacuously"). Will
report this gap numerically and explicitly in results/T-03-ATLAS.md — this DoD item
("solvability tape exists for every level and all pass") is NOT achievable to full "all pass" green
in this session; only the "tape exists" + "harness wired and ready" half is deliverable now.

### Next step (as of writing this entry)

About to write `packages/core/test/level/level.test.ts` (defaults, validation per-rule rejection,
33-level round trip, levelId, customLevelId) and the solvability harness (adapter + run.test.ts +
33 placeholder tape JSON files). `level.ts` and `levels.json` are already written and pass
`tsc --noEmit -p tsconfig.json` clean (verified). `levels.json` verified byte-identical to
`reference/godot/data/levels_builtin.json` via `diff` and sha256sum match.
