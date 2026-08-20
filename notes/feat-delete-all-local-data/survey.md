# Grounding survey - feat/delete-all-local-data

Read-only survey. Every claim below is a file/line I opened, not an assumption.

## 1. What the settings screen has today

`packages/web/src/ui/screens/settings.ts` (269 lines, T-08 BRIDGE) renders, in order:

- player name field (`:42-61`) - writes `settings.username` via `ctx.storage.setSettings`
- display toggles (`:64-86`) - one `setSettings` per toggle
- control rebinding sections (`:201-215`), editor hotkey row (`:106-162`)
- a status card (`:256`) holding the `statusEl` paragraph
- **`resetBtn` (`:217-233`), label "Reset all controls to default"** - sets
  `controls = {...DEFAULT_CONTROLS}`, persists, calls `inputSource.setBindings`, resets the editor
  hotkey, and sets the status line to "Controls reset to default."
- footer back link (`:258`), `backHref` from router state `returnTo` (`:236-237`)

So the existing "reset all" is **controls-only**. It does not touch username, display toggles,
personal bests or custom levels. The screen mutates storage directly on every interaction; it is
built once per navigation (`ui/app.ts:98-121` rebuilds the screen subtree on each route render) and
reads `ctx.storage.getSettings()` once at build time (`settings.ts:37`).

## 2. What the app actually persists

| Key | Written by | Contents |
|---|---|---|
| `swingby:settings` | `storage/index.ts:56`, `persistSettings` `:212` | all settings incl. username, toggles, controls, `boostType`, and the undeclared `editLevelHotkey` key (INTERFACES.md documents it) |
| `swingby:bests` | `storage/index.ts:57`, `persistBests` `:224` | personal bests per level id |
| `swingby:custom_levels` | `storage/index.ts:58`, `persistCustomLevelsOrThrow` `:248` | custom levels from the editor |
| `swingby:score_queue` | `net/queue.ts:36`, `saveItems` `:194` | offline leaderboard submission queue (T-13 PODIUM) |
| `swingby:__probe__` | `storage/index.ts:117` | write-probe, removed immediately |
| `swingby:__net_probe__` | `net/persist.ts:68` | write-probe, removed immediately |

Two modules touch `localStorage`: `storage/index.ts` and `net/persist.ts` (the latter documents at
`:1-17` why it is a sibling implementation rather than a call through the frozen `Storage`
interface). Both degrade to an in-memory `Map` when `localStorage` is absent or throws
(`storage/index.ts:127`, `net/persist.ts:78`).

`grep -r 'document\.cookie|sessionStorage|indexedDB' packages/` → no production usage at all. The
only `document.cookie` hit is a hostile-URL test string (`test/editor-share.test.ts:238`).
`editor/**` persists nothing (no draft key).

## 3. Confirmation patterns that already exist

- `editor/dialogs.ts:83` `confirmDialog(root, {title, body, confirmLabel, cancelLabel, danger})` →
  `Promise<boolean>`; builds `.overlay > .panel.dialog[role=dialog][aria-modal=true]` with
  `.dialog-sub` body and `.dialog-actions` holding `.btn.btn-block.btn-danger` + `.btn-ghost`,
  traps focus, Escape = cancel, and mutates nothing on cancel by construction.
- `ui/screens/ingameMenu.ts:73-89` builds the same markup in `ui/`, using `trapFocus`
  (`ui/dom.ts:80`) and `h()` (`ui/dom.ts:24`).
- CSS for all of it is already shipped: `.overlay` (`styles/components.css:410`), `.dialog` (`:424`),
  `.dialog-sub` (`:444`), `.dialog-actions` (`:450`), `.btn-danger` (`:53`), `.btn-ghost` (`:63`),
  `.btn-block` (`:73`).
- **No `window.confirm` anywhere in the repo.**

`editor/dialogs.ts` is T-11 DRAFT's file and is explicitly self-contained ("no import from
`ui/**`", `:7-13`), and another session owns `editor/**` right now - so it cannot be imported or
edited; its shape is the pattern to mirror inside `ui/`.

## 4. Storage interface constraints

The frozen `Storage` interface (INTERFACES.md "web/storage/index.ts - T-10 VAULT") is
`getSettings/setSettings/getBest/recordBest/listCustomLevels/saveCustomLevel/deleteCustomLevel/
export/import`. There is no `clear()` and no generic key slot - the same gap T-13 PODIUM hit and
documented in `net/persist.ts:1-17`.

Each `createStorage()` hydrates its caches once, synchronously, at construction
(`storage/index.ts:197-205`). So wiping the keys under a live instance leaves that instance serving
stale in-memory data - which is exactly the "stale state in memory while storage is empty" failure
the brief warns about. `net/queue.ts` by contrast re-reads the key on every operation
(`loadItems()` at `:169`, called by `size`, `peek`, `submit`, `drain`), so it has no stale cache -
but a `drain()` awaiting an HTTP response across the wipe can re-`saveItems` afterwards
(`:199-212`).

## 5. Test infrastructure

- No jsdom (`hud/__tests__/fakeDom.ts:2` states it). DOM-level suites either use hand-rolled fakes
  or stay out of the DOM; CSS assertions are made against rule text
  (`packages/web/test/ui-toggle-css.test.ts`).
- `storage/__tests__/fake-local-storage.ts` is a `localStorage`-shaped double with `forceSet`, and
  `storage/__tests__/storage.test.ts:18-39` shows the install/restore discipline for
  `globalThis.localStorage`.
- Playwright + Chromium preinstalled, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
  `notes/feat-edit-current-level/verify.mjs` is the precedent for a driver script.
