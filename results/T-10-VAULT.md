# T-10 VAULT — Results

Local persistence: settings, personal bests, custom levels. Area `packages/web/src/storage`.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `createStorage` + the `Storage` interface (exact INTERFACES.md signatures) | `packages/web/src/storage/index.ts` | Done |
| 2 | Schema versioning and the Godot→web score migration | `packages/web/src/storage/migrate.ts` | Done |
| 3 | Tests incl. corruption, quota, and unavailable-storage paths | `packages/web/src/storage/__tests__/storage.test.ts`, `.../__tests__/migrate.test.ts` | Done |
| 4 | A sample Godot `scores.json` fixture and its expected mapping | `packages/web/src/storage/__tests__/fixtures/godot-scores.json` (expected mapping = the assertions in `migrate.test.ts`'s `importGodotScores — real fixture` block) | Done |

**Path deviation from the task doc, by explicit instruction:** the task doc lists test/fixture
paths under `packages/web/test/...`. The orchestrator's hard rule for this run restricts every
file I touch to `packages/web/src/storage/**` (tests included), because `packages/web/test/` is
outside my ownership row and other tasks were editing the tree concurrently. Tests live at
`packages/web/src/storage/__tests__/*.test.ts` and the fixture at
`packages/web/src/storage/__tests__/fixtures/godot-scores.json` instead — same content and
coverage, different location, `npm test -w @swingby/web` picks them up either way (default vitest
discovery, no config needed).

Also shipped, not a listed deliverable but used by both files above: `packages/web/src/storage/__tests__/fake-local-storage.ts`,
a small in-memory `localStorage`-shaped test double with two configurable failure modes
(`throwOnWrite`, `quotaBytes`) — written per the environment instruction to avoid a `jsdom`
dependency.

## Definition of done

- [x] Settings round-trip across reload — `storage.test.ts` "settings > round-trips across a simulated reload" (same backing store, fresh `createStorage()` call, all fields including untouched defaults intact).
- [x] `recordBest` returns correct `timeIsNew`/`boostIsNew`, improving each metric **independently** — 4 dedicated tests: first-run-both-new, beat-time-miss-boost, beat-boost-miss-time, and a tie counts as *not* new (strict `<`, matching `DataManager.gd`'s `>` comparison, not `<=`).
- [x] Custom levels round-trip, including ones near the size limit — "round-trips save/list/delete", "round-trips across a simulated reload", and "custom levels near (but under) the quota still round-trip fully" (a 40-object level saved into a store whose configured quota leaves only ~16 bytes of headroom).
- [x] Corrupt data in **every** key: game still starts, defaults restored, no uncaught exception — 3 keys × garbage JSON (parametrized `it.each`) + 3 explicit wrong-shape cases (`[]` for settings, `[]` for bests, `{}` for custom levels) + one partial-corruption case (one bad entry inside an otherwise-good bests file drops only that entry). 9 tests total covering this line item.
- [x] Works with `localStorage` throwing on access (Safari private mode) — falls back in-memory — "storage unavailable" describe block, both the throws-on-every-write case and the entirely-absent case; every `Storage` method exercised (`setSettings`, `recordBest`, `saveCustomLevel`) and asserted not to throw, with the in-memory cache still reflecting the write.
- [x] A real Godot `scores.json` imports and maps onto the right level ids — `migrate.test.ts`, fixture-based tests below. `builtin_0 → levelId(0) === "builtin-00"`, `builtin_4 → levelId(4) === "builtin-04"` (0-indexed, confirmed against `@swingby/core`'s landed `levelId`, not guessed).
- [x] Unknown stored fields survive a write cycle — "unknown stored fields survive a write cycle (top-level and inside controls)": a field the current build doesn't know about, and an unknown control-binding action, both still present after an unrelated `setSettings` call, verified both in the live returned object and in what was actually persisted to the backing store.
- [x] No import from `game/`, `ui/`, or `render/` — confirmed by grepping every `import` line across `packages/web/src/storage/**`: only `@swingby/core`, `vitest`, `node:fs`/`node:url` (test-only), and this module's own files.
- [x] Global checklist (PROJECT.md §7) — see "Full verification" below: typecheck clean repo-wide, `npm test` green repo-wide (247 passed + 1 skipped, not just my own suite), no file outside my ownership row touched, zero new runtime dependencies in `packages/core` (none added anywhere — this task added no dependencies at all), interfaces consumed (`Level`, `Settings`, `customLevelId`, `levelId`, `DEFAULT_SETTINGS` from `@swingby/core`) are used exactly as landed, no changes to INTERFACES.md needed.

## Robustness table

| Case | How it was induced | Result |
|---|---|---|
| Empty store | Fresh `FakeLocalStorage()`, no prior keys | Did not throw, fell back to defaults (`getSettings()` deep-equals `DEFAULT_SETTINGS`, `getBest()` → `null`, `listCustomLevels()` → `[]`) |
| Garbage JSON — settings | `"{{{not json"` force-written to `swingby:settings` | Did not throw, fell back to defaults |
| Garbage JSON — bests | `"{{{not json"` force-written to `swingby:bests` | Did not throw, fell back to defaults |
| Garbage JSON — custom levels | `"{{{not json"` force-written to `swingby:custom_levels` | Did not throw, fell back to defaults |
| Wrong-shape JSON — settings (`[]` where object expected) | Force-written directly | Did not throw, fell back to defaults |
| Wrong-shape JSON — bests (`[]` where object expected) | Force-written directly | Did not throw, fell back to defaults |
| Wrong-shape JSON — custom levels (`{}` where array expected) | Force-written directly | Did not throw, fell back to defaults |
| One malformed entry inside an otherwise-valid bests file | `{"builtin-00": {...valid...}, "builtin-01": {timeMs:"oops"}}` | Did not throw; valid entry kept, only the malformed entry dropped |
| `localStorage` throws on every write (Safari private mode) | `FakeLocalStorage({ throwOnWrite: true })` as `globalThis.localStorage` | Did not throw anywhere — `createStorage()`, `setSettings`, `recordBest`, `saveCustomLevel` all succeed in-memory for the session |
| `localStorage` absent entirely | `delete globalThis.localStorage` | Did not throw anywhere — identical in-memory behaviour to the case above |
| Quota exceeded on `saveCustomLevel` (working store, genuinely full) | `FakeLocalStorage({ quotaBytes: N })`, saved in a loop until it threw | **Did throw**, deliberately — `QuotaExceededError` propagates to the caller uncaught by the module, and `listCustomLevels()` afterward has exactly the count that actually persisted (cache never disagrees with the store) — this is the one intentional exception to "never throw," required by the task doc's DoD line for `saveCustomLevel` specifically |
| `import(json)` given garbage/wrong-shape JSON | `"{{{not json"`, `"[1,2,3]"`, `"null"` | Did not throw, state left exactly as it was before the call |

The last row is the module's one deliberate departure from "never throw": settings/bests reads
*and* writes never throw under any of the above, but `saveCustomLevel`/`deleteCustomLevel` are
persist-first and let a genuine write failure propagate, per the task doc's explicit instruction
("Quota exceeded on custom level save → surface a clear error to the caller; do not silently
drop"). Full reasoning is in `notes/T-10-VAULT/log.md` (session 1 entry, "Corruption-handling
decisions per key").

## export() / import() round-trip fidelity

One `Storage`, populated with:
- 3 known settings fields changed from default (`username`, `trail`, `boostType`) + 1 field
  unknown to this build (simulating a newer-build export field arriving via a raw write) = **4
  settings values**
- **4 personal bests**, one per level, across 4 distinct level ids
- **3 custom levels**

`export()` → `JSON.stringify` human-readable payload → fresh, independent `Storage` →
`import(json)`.

**Result: 11/11 items preserved** (4 settings values, 4 bests, 3 custom levels — each checked
individually in the test, not just object-equality on the whole blob). A second round-trip test
confirms `import()`'s merge semantics specifically: importing an older backup with a worse time
but better boost onto a store that already has a better time keeps the better time AND takes the
better boost — restoring a backup never regresses a metric already beaten locally. A third
confirms custom levels are de-duplicated by `customLevelId` on import rather than appended blindly.

## Prove the tests can fail

Temporarily edited `readJson()` in `index.ts` to rethrow instead of catching `JSON.parse` errors
(one line, marked `INJECTED BUG` in the diff), then ran:

```
npx vitest run packages/web/src/storage
```

Result: **1 file red, 3 failed / 42 passed** — exactly the three "garbage JSON never throws"
corruption tests (settings, bests, custom_levels), each failing with
`AssertionError: expected [Function] to not throw an error but 'SyntaxError: ...' was thrown`.
Reverted the edit immediately after capturing this output. Re-ran: back to **2 files, 45/45
passed**, and a full-repo `tsc --noEmit` afterward still reported 0 errors (confirming the revert
was clean, not just "tests pass again by coincidence").

## Full verification (numbers)

| Command | Result |
|---|---|
| `npx vitest run packages/web/src/storage` | **2 test files passed, 45/45 tests passed** (18 in `migrate.test.ts`, 27 in `storage.test.ts`) |
| `npx tsc --noEmit -p tsconfig.json` (whole repo) | **0 errors** |
| `npm run typecheck` (contracted root script, `tsc --build --force`) | Clean — no output, exit 0 |
| `npm test -w @swingby/web` | **9 test files passed, 82/82 tests passed** (my 45 + T-04 AURORA's 37 render tests — confirms nothing of mine broke their suite) |
| `npm test` (whole repo) | **15 test files passed, 247 passed + 1 skipped (248 total)** — all green, including T-01 KEPLER's, T-02 TAPE's, T-03 ATLAS's suites |

## Interface / dependency notes

- **`customLevelId` / `levelId`**: the task brief anticipated T-03 ATLAS might not have landed and
  asked for a small, clearly-marked local fallback in that case. T-03 landed mid-task (twice
  observed across two interruptions: first `level.ts` existed but wasn't re-exported by the
  `@swingby/core` barrel yet, then it was). **The fallback has already been deleted** — this is
  not a pending TODO for a future session. `packages/web/src/storage/migrate.ts` and `index.ts`
  both import `customLevelId`/`levelId` directly from `@swingby/core`. Before deleting the
  fallback it was corrected to match the landed implementation exactly (0-indexed `levelId`,
  additive djb2 variant) so the swap is behaviour-preserving; both the correction and the final
  swap are recorded in `notes/T-10-VAULT/log.md`.
- **Backend choice deviation**: the task doc suggests IndexedDB for custom levels (for quota
  headroom beyond localStorage's ~5MB). This implementation uses `localStorage` for all three
  keys (settings, bests, custom levels) instead. Reason: the frozen `Storage` interface is fully
  synchronous (`listCustomLevels(): Level[]`, `saveCustomLevel(level: Level): void` — no Promise
  anywhere), and IndexedDB has no synchronous API, so there is no way to guarantee
  `listCustomLevels()` called immediately after `createStorage()` sees IndexedDB-hydrated data
  without either blocking (impossible) or a real race window. `localStorage` satisfies the frozen
  signatures exactly with no race. Quota behaviour is still fully covered (see the robustness
  table) via a configurable simulated quota in the test double — real-browser localStorage quotas
  will throw the same `QuotaExceededError` shape.
- **Settings persistence shape**: persisted as the same camelCase shape as the frozen runtime
  `Settings` type (not converted to Godot's snake_case `settings.json` shape). Reasoning: unlike
  `Level`/`LevelObject`, there is no parallel snake_case "persisted Settings" type anywhere in the
  frozen contract, nothing requires `settings.json` to round-trip byte-identical with Godot's file
  (only `levels.json` has that requirement, checked by T-03's own DoD), and Godot's key bindings
  (integer keycodes) aren't meaningfully convertible to the web's `KeyboardEvent.code` strings
  anyway — there's no cross-engine settings migration to preserve. The one migration this task
  needed to build — Godot `scores.json` → web `PersonalBest` — is fully implemented in
  `migrate.ts`'s `importGodotScores`, including the documented "efficient bucket's `time` field
  actually holds boost seconds" gotcha (read explicitly into `boostMs`, never conflated with
  `timeMs`).
- `importGodotScores`'s `custom_N` entries need the corresponding `custom_levels.json` content to
  derive a stable `customLevelId` (a `Level` carries no id). Pass it via `opts.customLevels`
  (parsed `Level[]`, same order Godot saved them in); without it, `custom_N` keys are skipped with
  an explicit reason (`"no matching entry in opts.customLevels"`) rather than guessed at. Covered
  by both branches in `migrate.test.ts`.

## Files

- `packages/web/src/storage/index.ts` — `Storage` interface, `PersonalBest`, `createStorage()`
- `packages/web/src/storage/migrate.ts` — schema versioning, corruption recovery per key, Godot `scores.json` import
- `packages/web/src/storage/__tests__/storage.test.ts` — 27 tests
- `packages/web/src/storage/__tests__/migrate.test.ts` — 18 tests
- `packages/web/src/storage/__tests__/fake-local-storage.ts` — in-memory test double (throw-on-write and quota simulation)
- `packages/web/src/storage/__tests__/fixtures/godot-scores.json` — sample Godot desktop scores fixture
- `notes/T-10-VAULT/log.md` — working log (decisions, dead ends, reasoning; written across 4 sessions due to two mid-task interruptions)
