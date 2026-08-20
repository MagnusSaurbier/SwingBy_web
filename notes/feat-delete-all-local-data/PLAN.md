# Implementation plan - feat/delete-all-local-data

**Status: submitted for review. No behaviour-changing code written. Awaiting GO.**

Request, verbatim:

> In the main settings: below the "reset all to defaults" button, offer a button to delete all local
> data (delete all cookies: custom levels, names, highscores, settings). Button has a confirmation
> ("Are you sure?") and leaves the game as if a new user opened it.

Grounding survey with file/line citations: [`survey.md`](survey.md). This document assumes it.

---

## 0. What I read the request as, including what I had to infer

| The request says | What I take it to mean | Inferred? |
|---|---|---|
| "below the 'reset all to defaults' button" | below `resetBtn` in `ui/screens/settings.ts:217`, whose actual label is **"Reset all controls to default"** - the only "reset all" control in the app | inferred (label differs from the request's wording; there is no other candidate) |
| "delete all cookies" | delete everything the app persists in the browser. The app uses **no cookies at all** - it persists four `localStorage` keys, all `swingby:`-prefixed (survey §2). "Cookies" is loose phrasing for "browser-side saved data" | inferred, and load-bearing: the wipe targets `localStorage`, not `document.cookie` |
| "custom levels, names, highscores, settings" | `swingby:custom_levels`, `username` inside `swingby:settings`, `swingby:bests`, and the rest of `swingby:settings` (toggles, key bindings, `boostType`, `editLevelHotkey`) | not inferred |
| - (not mentioned) | **also** `swingby:score_queue`, T-13 PODIUM's offline submission queue: local data written by the app that a "delete all local data" button that left it behind would be lying about | inferred; the brief asked for it explicitly |
| "confirmation ('Are you sure?')" | a modal confirm dialog in the repo's existing style (`.overlay` + `.panel.dialog`, focus-trapped, Escape = cancel), **not** `window.confirm` - the repo has no `window.confirm` anywhere and does have `editor/dialogs.ts:83 confirmDialog()` | inferred from the pattern survey |
| "leaves the game as if a new user opened it" | see §2 | inferred, concretely |

---

## 1. What the feature does

A second, destructive control on the Settings screen, directly below "Reset all controls to
default":

1. **Button** - "Delete all local data", `.btn.btn-block.btn-danger`, inside its own
   `.panel.controls-section` block headed "Local data" with a one-line `.toggle-desc` explanation.
   No new CSS: every class already exists (survey §3).
2. **Confirmation** - pressing it opens a focus-trapped modal built with `ui/dom.ts`'s `h()` and
   `trapFocus()`, mirroring `editor/dialogs.ts:83`'s `confirmDialog` shape and
   `ui/screens/ingameMenu.ts:73-89`'s markup:
   - title: **"Delete all local data?"**
   - body: "This permanently deletes everything SwingBy has saved in this browser: your player
     name, settings and key bindings, personal best times, and your custom levels. Scores you have
     already submitted to the leaderboard and levels you have already shared stay online. This
     cannot be undone."
   - actions: **"Delete everything"** (`.btn-danger`) and **"Cancel"** (`.btn-ghost`); Escape and
     Cancel both resolve `false`
3. **On confirm** - every `swingby:`-prefixed key is removed from `localStorage` (and from
   `sessionStorage`, defensively - the app writes none today), then the app navigates with
   `window.location.assign("/")`: a real document load onto the main menu.
4. **On cancel** - nothing is read, written or removed, and no navigation happens. The dialog closes
   and focus returns to the button.

## 2. "As if a new user opened it" - concretely

A full document load is what makes this true, rather than careful bookkeeping:

- `localStorage` holds no `swingby:*` key, so `createStorage()` in the new document hydrates from an
  empty store and returns `DEFAULT_SETTINGS` (username "Guest", default toggles, default controls,
  default `boostType`, default editor hotkey); `getBest()` is `null` for every level;
  `listCustomLevels()` is `[]`; `createSubmissionQueue().size()` is `0`.
- Every in-memory holder of that data is gone with the document: the `Storage` instance and its
  synchronous caches (`storage/index.ts:197-205` - these are the "stale state in memory while
  storage is empty" hazard the brief names), the router, the live `InputSource` the Settings screen
  created, the submission queue, any running `GameSession`.
- The user lands on `/` (main menu), because `/settings` was reached with router state (`returnTo`)
  that a bare `location.reload()` would preserve, and because "as if a new user opened it" means the
  first screen a new user sees.
- What is deliberately *not* reset: the browser's HTTP cache, and the URL history stack. Neither is
  app data. There is no service worker and no cache-API usage (survey §2), so nothing else survives.

Alternative considered and rejected: **rebuild in place** (wipe, then `ctx.rerender()` /
`navigate("/")`). Rejected because the live `Storage` instance in `ui/app.ts:84` is created once per
app mount and caches settings/bests/levels at construction, so it would keep serving the deleted
data until the next real load - precisely the worse-than-not-wiping outcome. Making it correct would
require adding a cache-invalidating method to the frozen `Storage` interface in `storage/index.ts`,
T-10 VAULT's file, which `feat/brake-flip-burn` may be editing.

## 3. The boundary against "Reset all controls to default"

| | Reset all controls to default | Delete all local data |
|---|---|---|
| Key bindings + editor hotkey | reset to defaults | deleted (back to defaults) |
| Player name | **kept** | deleted |
| Display toggles, `boostType` | **kept** | deleted |
| Personal bests | **kept** | deleted |
| Custom levels | **kept** | deleted |
| Offline submission queue | **kept** | deleted |
| Confirmation | none (cheap, re-doable) | required |
| After it runs | stays on Settings, status line updates | full reload onto the main menu |

The two are visually distinguished: reset stays a neutral `.btn`, delete is `.btn-danger` under its
own "Local data" heading with a one-line description ("Erases everything saved in this browser -
name, settings, personal bests and custom levels."). To remove the remaining ambiguity I propose
**relabelling nothing** - the existing button already says "controls".

## 4. What it deliberately does **not** do

- **No server-side deletion.** Scores already submitted to the leaderboard, and levels already
  shared via `POST /api/levels`, stay on the server under whatever name was submitted. The
  confirmation says so in one sentence (see §1); the plan does not add an account-deletion or
  score-retraction API. If you want the copy to omit that sentence, say so - see §9 Q1.
- **No per-category deletion** ("delete just my highscores"), no "export a backup first" step, no
  undo. The existing `Storage.export()` already lets a user save a backup by other means; wiring an
  export-before-delete flow is a separate feature.
- **No change to "Reset all controls to default"**, and no relabelling of existing controls.
- **No new files or edits under `packages/core/**` (no physics, no level solvability impact),
  `packages/web/src/editor/**`, `packages/web/src/storage/**`, `packages/web/src/net/**`, or
  `packages/web/src/hud/**`.** In particular the frozen `Storage` interface gains nothing, so
  `feat/brake-flip-burn` and this branch cannot collide.
- **No new dependency** anywhere; nothing added to `packages/core`.
- **Does not clear the HTTP cache** or anything not written by the app.
- **Not reachable from the in-game menu**, only from the main Settings screen, as asked.

## 5. Surface it adds

| Path | Owner (INTERFACES.md) | Change |
|---|---|---|
| `packages/web/src/ui/localData.ts` | T-08 BRIDGE (`ui/**`) | **new**, ~70 lines: the wipe and its orchestration, DOM-free and therefore unit-testable in node |
| `packages/web/src/ui/dialog.ts` | T-08 BRIDGE | **new**, ~55 lines: `confirmDialog()` for `ui/`, same shape as `editor/dialogs.ts:83`, built on `h()` + `trapFocus()` |
| `packages/web/src/ui/screens/settings.ts` | T-08 BRIDGE | the "Local data" block + wiring, ~25 lines |
| `packages/web/test/delete-local-data.test.ts` | new | the feature's suite (§7) |
| `notes/feat-delete-all-local-data/*`, `results/feat-delete-all-local-data.md` | - | docs, plan, screenshots |

No route, no persisted state, no interface change, no CSS. `INTERFACES.md` needs no edit: nothing
crosses a task boundary - but the *fact* that a `swingby:`-prefixed key is now assumed to be
app-owned and wipeable is a convention worth recording, so I propose one short paragraph there if
you want it (§9 Q2).

Shape of the new module (names may shift slightly in review of my own code, behaviour will not):

```ts
export const LOCAL_DATA_KEY_PREFIX = "swingby:";

interface EnumerableStore {           // the slice of the DOM Storage API needed
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/** Every `swingby:`-prefixed key currently present. Never throws. */
export function collectLocalDataKeys(store: EnumerableStore): string[];

/** Removes them from every store given. Never throws; returns what it removed. */
export function wipeLocalData(stores?: readonly (EnumerableStore | null)[]): string[];

/** Confirm-then-wipe-then-reload. Wipes nothing and navigates nowhere if `confirm` resolves false. */
export async function requestDeleteAllLocalData(deps: {
  confirm: () => Promise<boolean>;
  wipe?: () => string[];
  navigate?: (href: string) => void;   // defaults to window.location.assign
}): Promise<{ deleted: boolean; removedKeys: string[] }>;
```

**Why a prefix sweep rather than a hard-coded list of four keys:** it covers keys this branch does
not know about - `swingby:score_queue` was already one such (owned by T-13, not T-10), and thirteen
other tasks can add more. "The wipe leaves no key behind" is then true by construction rather than by
maintenance, and a test asserts every key constant in the repo starts with that prefix so a future
key that breaks the convention fails loudly (§7.8). Foreign keys (anything not `swingby:`-prefixed,
e.g. from another app on the same origin during local dev) are left alone.

**Why the wipe lives in `ui/` and touches `localStorage` directly:** `storage/index.ts:3` claims to
be the only module touching `localStorage`, but `net/persist.ts:1-17` already documents why it is
not (the frozen interface has no room). A cross-module wipe cannot be expressed through the frozen
`Storage` interface either, and the alternative - extending that interface - edits the one file
another live session may be editing. This follows the precedent rather than inventing one.

## 6. Blast radius

- `ui/screens/settings.ts` is the only existing file changed; the added block is appended after
  `resetBtn` and touches no existing local, listener or teardown path. Its `destroy()` gains one
  line to dismiss an open dialog if the screen is torn down while the confirm is up.
- Storage keys: the wipe only *removes*. No format, migration or default changes, so existing users
  who never press the button see no change whatsoever - no data migration, no URL change, no default
  change.
- **Known race, stated honestly:** an in-flight `queue.drain()` awaiting an HTTP response can call
  `saveItems` after the wipe (`net/queue.ts:199-212`), re-creating `swingby:score_queue` with an
  *empty* `items` array in the milliseconds before navigation. Consequence: a key may exist again,
  containing nothing, and the next load reads `[]` - indistinguishable from a fresh user in
  behaviour. I am not adding a queue-quiescing API to T-13's module to close a window that produces
  no observable difference; if you want it closed properly it needs a change in `net/**`, which is
  outside this branch's lane.
- Screens that read storage at build time (`levelSelect`, `workshop`, `play`) are all rebuilt by the
  document load, so none can observe the wiped state through a stale cache.

## 7. Tests (`packages/web/test/delete-local-data.test.ts`, no jsdom needed)

Against `storage/__tests__/fake-local-storage.ts`-style doubles, using the real `createStorage()`
and `createSubmissionQueue()` to prove the *effect* rather than restating the implementation:

1. **Wipes all four real keys.** Seed via the real writers (`setSettings`, `recordBest`,
   `saveCustomLevel`, `queue.submit`), wipe, assert no `swingby:`-prefixed key remains - enumerated
   from the store, so an unlisted key fails the test.
2. **A future/unknown `swingby:` key is wiped too** (`swingby:some_new_thing`).
3. **Foreign keys survive** (`theme`, `other-app:token` untouched).
4. **A fresh reader sees a new user**: after the wipe, `createStorage().getSettings()` deep-equals
   `DEFAULT_SETTINGS`, `getBest(...)` is `null`, `listCustomLevels()` is `[]`,
   `createSubmissionQueue({store}).size()` is `0`.
5. **Cancel deletes nothing** (the "what it must refuse to do" case):
   `requestDeleteAllLocalData({confirm: async () => false})` removes zero keys, leaves the seeded
   store byte-identical, and never calls `navigate`.
6. **Confirm deletes and navigates to `/` exactly once.**
7. **Never throws** when there is no `localStorage` at all, and when `removeItem` throws on every
   call (Safari-private-mode shape) - the wipe reports what it managed to remove and the caller
   still proceeds, matching the storage layer's "never throw" contract.
8. **Convention guard**: reads `storage/index.ts` and `net/queue.ts` as text and asserts every
   `"swingby:..."` literal in them starts with `LOCAL_DATA_KEY_PREFIX` (same technique as
   `game/__tests__/input.test.ts:297`), so a key added outside the namespace fails here rather than
   silently surviving a wipe.

Each of 1, 2, 4, 5 fails against today's tree (no wipe exists), which is what makes them cover the
feature rather than accompany it.

## 8. Verification matrix

- `npm run typecheck`, `npm test` (full suite, before/after counts reported), `npm run lint`,
  `npm run build -w @swingby/web`, `npm run size` - every number quoted in the PR, including the
  size delta of the two new modules.
- Playwright + Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, never `playwright install`),
  driver committed under `notes/feat-delete-all-local-data/`:
  - **Desktop 1280×800**: Settings with the new button; the confirmation dialog; Cancel →
    `localStorage` still holds all four keys (asserted in `page.evaluate`, not by eye); Confirm →
    lands on `/`, `localStorage` has no `swingby:` key, main menu and Settings both show first-run
    state (name "Guest", default toggles, no personal bests, no custom levels).
  - **Mobile 390×844 with `hasTouch: true`, portrait and landscape**, driving the button and the
    dialog with `locator.tap()` (not `click()`), because touch is a first-class requirement here and
    a synthesized click proves nothing about a real tap.
  - Screenshots: settings-with-button, confirm-dialog, post-wipe first-open, mobile equivalents.
- Seeding for those runs uses the app's own code paths via `page.evaluate` (play a level for a best
  is not needed - `recordBest` through the shipped `createStorage()` is the same write), which I will
  state plainly in `results/`.

## 9. Open questions - answers change what gets built

1. **Does the confirmation mention the server?** I propose yes, the one sentence in §1 ("Scores you
   have already submitted … stay online"), because a user pressing "delete all my data" plausibly
   believes it covers the leaderboard entry carrying their name. Say the word and I drop it.
2. **Record the `swingby:` namespace convention in `INTERFACES.md`?** One paragraph, no contract
   change. Default if you do not answer: I leave `INTERFACES.md` untouched and record it only in
   `notes/`.
3. **Landing screen after the wipe:** I propose `/` (main menu). The alternative - stay on Settings
   showing freshly-defaulted values - demonstrates the wipe more visibly but is not what a new user
   sees. Default: `/`.

## 10. Risks

- The only irreversible action in the app. Mitigated by the confirm dialog, `.btn-danger` styling,
  explicit copy, and Escape/Cancel defaulting to no-op; not mitigated by any undo (see §4).
- A `localStorage`-enumerating sweep behaves differently from the injected-`BackingStore` indirection
  the storage modules use; the wipe therefore needs the DOM `Storage` API's `length`/`key()`, which
  the existing `BackingStore` interface lacks. That is why §5 defines its own narrow
  `EnumerableStore` rather than reusing `BackingStore` - a small deliberate divergence, called out
  so it is not read as sloppiness.
