# T-10 · VAULT — Local persistence

**Area:** `packages/web/src/storage` · **Depends on:** nothing · **Blocks:** T-08 BRIDGE

## Goal

Settings, personal bests, and custom levels surviving a reload. Small, boring, and depended on by
almost everything — get it done early.

## Owned files

```
packages/web/src/storage/index.ts
packages/web/src/storage/migrate.ts
packages/web/test/storage.test.ts
```

## Reference

`reference/godot/scripts/DataManager.gd` (127 lines). It writes three files —
`user://settings.json`, `user://scores.json`, `user://custom_levels.json` — with this score shape:

```gdscript
scores := { "fastest": { <key>: {"time": float, "name": String} },
            "efficient": { <key>: {"time": float, "name": String} } }
```

Note `efficient` also stores its value under the key `"time"`, holding boost seconds. Do not
replicate that confusion in the web schema; map it to `boostMs` on the way in.

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#webstorageindexts--t-10-vault).

## Backend choice

`localStorage` for settings and bests — a few KB, synchronous access is convenient, and the loop
never touches it. **IndexedDB for custom levels**, which are unbounded and can exceed the ~5 MB
localStorage quota once a player authors a few dozen. Keep the async boundary inside the module;
`listCustomLevels()` may return from an in-memory cache hydrated at startup.

## Robustness

This module must never be the reason the game fails to start.

- Corrupt JSON → log, reset that key to defaults, keep going. Never throw out of a getter.
- `localStorage` unavailable (Safari private mode, disabled cookies) → fall back to an in-memory
  store and continue. The game is fully playable without persistence; losing settings is a far
  better failure than a white screen.
- Unknown fields in stored settings → preserve them across writes. A user who played a newer build
  should not lose data by opening an older one.
- Quota exceeded on custom level save → surface a clear error to the caller; do not silently drop.

## Versioning and migration

Store a schema version alongside the data from day one. `migrate.ts` upgrades old shapes forward.
Version 1 is what you ship; the migration path that matters immediately is **Godot desktop → web**.

Godot keys scores by level *index*; T-03 ATLAS defines stable string ids. Provide a documented
import that maps the old index-keyed `scores.json` onto the new ids, so a desktop player can carry
their bests over by pasting a file. `export()` / `import()` are the vehicle — make the exported
format human-readable JSON, not an opaque blob.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `createStorage` + the `Storage` interface | `packages/web/src/storage/index.ts` |
| 2 | Schema versioning and the Godot→web score migration | `packages/web/src/storage/migrate.ts` |
| 3 | Tests incl. corruption, quota, and unavailable-storage paths | `packages/web/test/storage.test.ts` |
| 4 | A sample Godot `scores.json` fixture and its expected mapping | `packages/web/test/fixtures/` |

## Definition of done

- [ ] Settings round-trip across reload
- [ ] `recordBest` returns correct `timeIsNew` / `boostIsNew`, improving each metric
      **independently** — a run can beat the best time while missing the best efficiency
- [ ] Custom levels round-trip, including ones near the size limit
- [ ] Corrupt data in **every** key: game still starts, defaults restored, no uncaught exception
- [ ] Works with `localStorage` throwing on access (Safari private mode) — falls back in-memory
- [ ] A real Godot `scores.json` imports and maps onto the right level ids
- [ ] Unknown stored fields survive a write cycle
- [ ] No import from `game/`, `ui/`, or `render/`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Note

T-06 HELM's rebinding and T-08 BRIDGE's settings screen both write through `setSettings`. Neither
touches `localStorage` directly — you are the only module that does. Enforce that boundary in review.

## How to verify

```bash
npm test -w @swingby/web -- storage
npm run typecheck
```

**1. Corruption, every key.** For each of settings, scores, and custom levels, set the key to
`"{{{not json"` in DevTools and reload. The game must start with defaults restored and no uncaught
exception in the console. Repeat with valid JSON of the wrong shape (`[]` where an object is
expected) — that is the case that usually slips through.

**2. Storage unavailable.** Safari → Private window, or in Chrome override `localStorage.setItem` to
throw. The game must remain fully playable with an in-memory fallback.

**3. Independent metrics.** Record a run that beats the best time but not the best boost. Assert
`{ timeIsNew: true, boostIsNew: false }` and that the stored boost best is unchanged.

**4. Godot migration.** Take a real `scores.json` from the desktop build:

```bash
ls ~/Library/Application\ Support/Godot/app_userdata/SwingBy/
```

Import it and confirm each index-keyed entry lands on the right `levelId`. Note that Godot stores the
efficiency value under the key `"time"` — if boost bests come through equal to the time bests, that
is the bug.

**5. Forward compatibility.** Add an unknown field to stored settings, write through `setSettings`,
and confirm the unknown field is still present afterwards.

**6. Quota.** Save custom levels in a loop until it throws. The error must surface to the caller, not
be swallowed.
