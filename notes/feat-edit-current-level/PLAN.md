# Implementation plan — feat/edit-current-level

**Status: submitted for review. No code written. Awaiting GO.**

Request, verbatim:

> New feature reachable in settings and through selectable hotkey (defaults to opt+cmd+d):
> The currently played level will be opened in the level editor.

Grounding survey with file/line citations: [`survey.md`](survey.md). This document assumes it.

**Three open questions (§10) change what gets built.** They are marked at every point where they
bite. I have written the plan so everything non-contingent is fully specified and reviewable now,
and the contingent parts are presented as options with a recommendation I have *not* acted on.

---

## 0. Files I expect to write

**Definite** — all inside the lane you drew (`ui/**`, `game/**`, `storage/**` + tests):

| Path | Owner in INTERFACES.md | Change |
|---|---|---|
| `packages/web/src/ui/app.ts` | T-08 BRIDGE | one `RouteDef` added |
| `packages/web/src/ui/screens/editorPlaceholder.ts` | T-08 BRIDGE | resolve `:levelId`, pass `level` to `mountEditor` |
| `packages/web/src/ui/screens/play.ts` | T-08 BRIDGE | `PlayMeta.editHref?`, hotkey listener + teardown |
| `packages/web/src/ui/screens/settings.ts` | T-08 BRIDGE | hotkey rebind row (+ entry point, see Q3) |
| `packages/web/src/ui/view-models.ts` | T-08 BRIDGE | pure hotkey helpers + settings accessor |
| `packages/web/src/ui/__tests__/view-models.test.ts` | T-08 BRIDGE | new cases |
| `packages/web/src/ui/__tests__/router.test.ts` | T-08 BRIDGE | new cases |
| `packages/web/test/edit-current-level.test.ts` | new file | the feature's own suite |
| `notes/feat-edit-current-level/*.md`, `results/feat-edit-current-level.md` | — | docs |

**Nothing under `packages/web/src/editor/**`.** The design needs no change there: `mountEditor`
already takes `level?: Level` (`editor/editor.ts:807`) and already hydrates it
(`editor/editor.ts:215-222`); this feature only supplies it from a call site in `ui/`. If review
turns up something that does need an `editor/` edit, I stop and tell you rather than take it.

**Not written unless a question resolves that way:**

- `packages/web/src/styles/components.css` — only if the hotkey row cannot reuse `.control-row`
  (`components.css:466-482`). Expected: no change needed.
- **If Q3 resolves to "the paused in-game menu":** `ui/screens/ingameMenu.ts` (mine) **plus**
  `packages/web/src/hud/pause.ts` and `packages/web/src/hud/index.ts`, which are **T-09 GAUGE's
  and outside the lane you drew.** A new menu button needs a callback threaded
  `mountGauge` → `mountPausePanel` → `mountIngameMenu`. Flagging now, not assuming.
- `INTERFACES.md` — this adds one persisted settings key (§4). It is a cross-task contract by the
  same logic as everything else in that file. I propose a short subsection; say if you would rather
  it stay out.

`packages/core/**` is untouched. No new dependency anywhere. `packages/core` stays zero-dependency.

---

## 1. What the feature does

While a level is being played, the player can open **that same level** in the level editor, by
either of two routes:

1. **A hotkey**, pressed on the Play screen. Rebindable, defaulting to the owner's requested combo
   (see Q1/Q2 — the *representation* of that default is the open part, not the fact of it).
2. **An entry in settings** (see Q3 for which "settings").

Both perform the identical action: navigate to `/editor/<the level's id>`, where the editor mounts
seeded with that level's bodies, goal, goal range, name and author, exactly as
`createEditorEngine` already does for any `initialLevel`.

Checkable when done:

- [ ] Playing `builtin-07`, pressing the hotkey lands on `/editor/builtin-07` with that level's
      bodies on canvas, not an empty stage.
- [ ] The same for a locally-saved custom level, addressed by its `customLevelId`.
- [ ] `/editor` with no id still opens an empty stage — byte-identical behaviour to today.
- [ ] `/editor/<nonsense>` renders a not-found panel and mounts **no** editor.
- [ ] The hotkey is reachable and rebindable from Settings, and the chosen binding survives reload.
- [ ] The hotkey does nothing when focus is in a text field, and nothing after leaving Play.

---

## 2. What it deliberately does NOT do — the scope boundary

- **It does not make built-in levels editable.** `storage.saveCustomLevel` is append-only
  (`storage/index.ts:305-307`) and `customLevelId` is content-derived (`core/level.ts:395`).
  Opening Stage 08 in the editor and saving produces a **new custom level**; the built-in is
  untouched. This is existing editor behaviour, surfaced — not changed.
- **It does not add save-in-place / overwrite** for custom levels either. Saving an edited custom
  level leaves the original in the list as well. Changing that means changing `Storage`, which is
  T-10 VAULT's file and a real migration for existing users' data. Out of scope.
- **It does not work on shared levels (`/l/:shareId`).** Their `Level` is fetched and has no local
  id, so no `/editor/:levelId` URL can name it. Enforced structurally, not by a check: the new
  `PlayMeta.editHref` is optional and `sharedPlaceholder.ts` simply never sets it — so that file is
  not edited at all and the hotkey is inert there.
- **It does not preserve the in-flight run.** `ui/app.ts:88-89` destroys the current screen on every
  navigation and `play.ts:319-331` tears down session, gauge, input and audio. The attempt is lost.
  No "return to your run" is built.
- **It does not add general modifier-chord support to `game/input.ts`** or to the other 11
  bindings. Whatever Q1 decides applies to this one hotkey only.
- **It does not touch physics** — see §6.
- **It does not add touch/mobile access.** The editor already declares itself desktop/mouse only
  (`editor/editor.ts:832-834`); a hotkey is desktop-only by nature. The settings entry will be
  tappable, but what it opens is not — that is the editor's existing limitation, not this feature's.

---

## 3. Surface added — routes

One `RouteDef` in `ui/app.ts`'s table, **reusing the existing `editor` name** so `SCREENS` and
`TITLES` need no new entry:

```ts
{ name: "editor", pattern: "/editor" },
{ name: "editor", pattern: "/editor/:levelId" },   // new
```

`matchRoute` (`ui/router.ts:41-70`) compares segment counts exactly and takes the first match, so
the two never collide and `/editor/a/b` matches neither. This is the shape
`ui/screens/editorPlaceholder.ts:22-23` already names as the intended extension point:

> No `/editor/:levelId` route exists yet for editing an existing custom level

`editorPlaceholder.ts` then does exactly what `play.ts:57-68` already does for its own `:levelId`:
`resolveLevel(ctx.params.levelId, ctx.storage.listCustomLevels())` (`ui/view-models.ts:78`), pass
`level` on success, render the same not-found panel shape on failure, and — when there is no
param at all — take today's path unchanged. Links are built with `buildPath("/editor/:levelId", …)`,
the same inverse-of-matching helper `menu.ts:18` and `play.ts:73` use.

**Alternative rejected:** passing the `Level` through router `state` (the mechanism Settings' own
`returnTo` uses, `play.ts:159-163`). Rejected because it is not deep-linkable, does not survive a
reload the way every other screen in this app does, and contradicts the extension point the code
already signposts.

---

## 4. Surface added — persisted state

**One new top-level settings key**, e.g. `editLevelHotkey: string`, alongside `username`/`trail`/…

Why top-level and not a 12th entry in `controls`:

- `ControlAction` is `keyof typeof DEFAULT_CONTROLS` and both live in `packages/core/src/constants.ts`
  — **FROZEN** (`AGENTS.md` Rule 2; `INTERFACES.md:19` "frozen — nobody"). I will not edit it. Per
  Rule 2 this is a constraint to design around, and I am treating that as already answered, not as
  a question for you.
- Even if the key were smuggled into `controls`, it would be inert there: `input.ts:382-404`
  rebuilds bindings from `DEFAULT_CONTROLS` and drops unknown keys, and `codeToEdgeAction`
  (`:89-98`) is keyed by a bare `event.code`, which a chord can never equal. It would also enter
  the collision resolver and could silently unbind a real action.

Why this is safe without touching `storage/**`: `mergeSettings` (`storage/index.ts:162-175`) is
`{...DEFAULT_SETTINGS, ...stored, controls:{...defaultControls, ...storedControls}}` — a deliberate
**preserve-unknown** merge, so an unrecognised key round-trips load→save→load untouched, and
`setSettings` (`:259-269`) spreads the patch into a `Record<string, unknown>` cache. The *type*
`Settings` still lacks the key, so `ui/view-models.ts` will declare it and read/write it through two
small typed accessors with a cast — the identical friction `settings.ts:93-100` already documents
for `controls`, with the same explanation in a comment.

**Existing users:** additive only. Absent key → default. No existing setting, saved custom level,
personal best, URL or default is changed. `export()`'s payload gains the key on next write, which
`import` already tolerates (unknown keys are preserved, same merge).

---

## 5. Surface added — hotkey matching (pure, in `ui/view-models.ts`)

All of this is DOM-free and unit-testable under plain-node vitest, which is why it goes in
`view-models.ts` — the file whose header states exactly that purpose.

```ts
export const DEFAULT_EDIT_LEVEL_HOTKEY: string;
export function matchesHotkey(ev: {code, ctrlKey, altKey, shiftKey, metaKey}, binding: string): boolean;
export function resolveHotkeyCapture(ev: {...}): {cancel: true} | {cancel: false; binding: string};
export function hotkeyLabel(binding: string, opts: {apple: boolean}): string;
export function isTypingTarget(t: {tagName?, isContentEditable?}): boolean;
```

**Binding format (if Q1 → chords):** a single string, modifiers in the fixed canonical order
`Ctrl`, `Alt`, `Shift`, `Meta`, then the `KeyboardEvent.code`, joined by `+` —
`"Alt+Meta+KeyD"` for ⌥⌘D. One string keeps it inside the repo's existing "a binding is a string in
settings" convention, so persistence, export/import and the rebind button all work unchanged.
**If Q1 → bare key**, the same functions take a plain `code` and the chord branch is never built.

`hotkeyLabel` reuses the existing `codeLabel` (`view-models.ts:108`) for the key half and prefixes
the modifiers; `apple` is passed in so the function stays pure and testable, with the one impure
platform sniff at the call site.

`isTypingTarget` deliberately re-derives `input.ts:138-147`'s `isEditableTarget` rather than
importing it (it is not exported, and `game/input.ts` is T-06's file this feature has no reason to
touch). Same deliberate-re-derivation precedent as `beatsPersonalBest` (`view-models.ts:225-238`),
which re-derives `recordBest`'s comparison instead of calling it, and says so.

**Listener placement.** One `document.addEventListener("keydown", …)` created inside
`mountPlayLevel` and removed in the returned `destroy()`. This is precisely the pattern
`ScreenResult.destroy`'s own doc comment names — *"only Settings (rebind capture) and Play
(Escape-to-pause, InputSource instance) currently need it"* (`ui/screen.ts:29-32`) — and the one
`settings.ts:136/186` implements. Not a new pattern. The teardown is the load-bearing part: a
leaked document listener surviving SPA navigation is the exact failure class `input.ts:318-331`
documents having already cost this repo once.

The listener fires only when `meta.editHref` is set, the event is not repeat, the target is not a
typing target, and `matchesHotkey` returns true — then `ev.preventDefault()` and
`ctx.navigate(meta.editHref)`.

---

## 6. Physics

**This feature does not touch physics.** No file under `packages/core/**` is modified — not
`physics.ts`, not `constants.ts`, not `levels.json`. No simulation constant, tick rate, substep
count or integrator path is read or written. Level solvability is unaffected: the 33 built-ins are
never mutated (§2), and the editor's existing `validate()` gate on save is unchanged. No new
dependency is added to `packages/core`, which stays zero-dependency and node-runnable.

---

## 7. Blast radius

| Touched | What else reads it | Risk | Mitigation |
|---|---|---|---|
| `ui/app.ts` ROUTES | `matchRoute` only; `router.test.ts` keeps its own local copy | very low — additive, exact-segment matching | new route cases in `router.test.ts` |
| `editorPlaceholder.ts` | `/editor` from `menu.ts:25` | low — no-param path unchanged | test asserting the no-param path still mounts an empty editor |
| `play.ts` `mountPlayLevel` | also called by `sharedPlaceholder.ts:36` | medium — a shared caller | `editHref` optional ⇒ shared path unchanged and untouched; test asserts inert there |
| `play.ts` document listener | whole app after navigation | **highest** — listener leak | removal in `destroy()`, plus an explicit teardown test and a real-browser check |
| `settings.ts` rebind state machine | the 11 existing bindings | medium — shared `pending`/keydown handler | the state machine's decisions move into pure helpers with tests; existing rebind re-verified in a real browser |
| new settings key | `storage.export()`/`import()` | low — preserve-unknown by design | round-trip test |

Protected code: `packages/core/src/types.ts`, `constants.ts` — **not touched** (§4).
`packages/web/src/editor/**` — **not touched** (§0). `packages/web/src/hud/**` — not touched unless
Q3 forces it, in which case I come back to you first.

**Sibling sweep.** The failure mode most relevant here is "a listener attached outside the screen's
own subtree that is not removed on teardown". I grepped for it: the only document/window listeners
in `ui/**` are `settings.ts:136` (removed at `:186`), `router.ts:134/159` (removed in `destroy()`),
and `play.ts:259` (removed at `:324`). All three already clean up. I found **no** existing instance
of the leak, and mine will follow the same shape. Reported as "nothing else", per the sweep rule.

---

## 8. Alternatives considered and rejected

1. **Add `editLevel` to `DEFAULT_CONTROLS`.** The most natural design, and unavailable: frozen file
   (`AGENTS.md` Rule 2, `INTERFACES.md:19`). Rejected.
2. **Teach `game/input.ts` modifier chords and route the action through `drainEvents()`.** Rejected:
   it needs a `ControlAction` that cannot exist without (1), and `input.ts`'s collision resolver and
   `codeToEdgeAction` map are both built around bare codes. It is also T-06's file, touched for no
   gain over a `ui/`-level listener.
3. **Router `state` instead of a route param.** Rejected — §3.
4. **An "Edit" button on Level Select.** Rejected: the request says the *currently played* level.
   (It may be a good idea separately; it is not this.)
5. **Save back over the source level.** Rejected — §2; it is a `Storage` change and a data
   migration.
6. **A `?level=` query param.** Rejected: `normalizePath` (`router.ts:22`) strips the query before
   matching, so the router cannot see it — path params are this app's only mechanism.

---

## 9. Tests, verification matrix, and what the feature must refuse

No jsdom in this repo. Pure logic runs under vitest; real DOM/keyboard/route behaviour is verified
in headless Chromium (Playwright 1.56.1 is globally installed at `/opt/node22/lib/node_modules`,
browsers at `/opt/pw-browsers` — the pattern `notes/T-04-AURORA/log.md` and
`notes/T-08-BRIDGE/log.md:52` already established). **No Playwright dependency is added to the
repo.**

### Unit (vitest) — including the refusals

| # | Assertion | Refusal? |
|---|---|---|
| 1 | `matchesHotkey` fires on the exact chord | |
| 2 | …**does not** fire when an extra modifier is held (Ctrl+⌥⌘D) | ✅ |
| 3 | …**does not** fire on the right code with a modifier missing | ✅ |
| 4 | …**does not** fire on the right modifiers with the wrong code | ✅ |
| 5 | `resolveHotkeyCapture` cancels on Escape | ✅ |
| 6 | …**does not** commit when only a modifier key is pressed | ✅ |
| 7 | `hotkeyLabel` renders both the apple and non-apple forms | |
| 8 | `isTypingTarget` true for INPUT/TEXTAREA/SELECT/contentEditable, false for canvas | ✅ |
| 9 | `matchRoute("/editor/builtin-07")` → `{name:"editor", params:{levelId:"builtin-07"}}` | |
| 10 | `matchRoute("/editor")` still → `{name:"editor", params:{}}` | |
| 11 | `matchRoute("/editor/a/b")` → `null` | ✅ |
| 12 | `buildPath("/editor/:levelId", …)` percent-encodes a custom id | |
| 13 | settings round-trip: set hotkey → reload storage → same value; absent → default | |
| 14 | `resolveLevel` returns null for an unknown id (drives the not-found panel) | ✅ |

Each new test is shown to cover rather than accompany the change: I will run the new suite against
the unmodified files first and record the failure output in `results/`.

### Real browser (headless Chromium), reported with numbers

| Case | Viewport / condition |
|---|---|
| Play `builtin-07` → hotkey → URL is `/editor/builtin-07`, canvas shows that level's bodies | 1280×800 desktop |
| Play a saved custom level → hotkey → editor seeded with it | 1280×800 |
| Settings entry performs the identical navigation | 1280×800 |
| Rebind the hotkey in Settings, reload, new binding works and old one does not | 1280×800 |
| The 11 **existing** rebindings still work (regression on the shared state machine) | 1280×800 |
| Hotkey pressed while the Settings username field is focused → nothing happens | 1280×800 |
| Navigate Play → main menu, press the hotkey → nothing happens (no listener leak) | 1280×800 |
| `/l/:shareId` → hotkey inert | 1280×800 |
| `/editor/<nonsense>` → not-found panel, no editor mounted | 1280×800 |
| Settings screen still scrolls to its Back link with the new row added | 390×844 portrait + landscape |
| `/editor` (no id) still opens an empty stage | 1280×800 |

Mobile viewports are included because a previous fix in this repo (`test/mobile-panel-scroll.test.ts`,
`notes/fix-mobile-panel-scroll/`) was exactly a settings-screen-height regression.

**What this verification cannot cover, stated up front:** whether macOS actually delivers ⌥⌘D to the
browser (Q2). This container is Linux with no macOS and no Mac keyboard. Playwright on Linux can
synthesize the event and prove the app handles it; it cannot prove the OS lets it through. I will
report it that way and will not claim otherwise.

### Gates

`npm run typecheck`, `npm test`, `npm run lint`, `npm run build -w @swingby/web && npm run size`,
each re-run and the numbers recorded. Baseline I measured on `5ceb841`: **56 files, 847 passed,
1 skipped, 40.55 KB gzip** (your 40.56 KB is the same run; the checker prints 40.55). Target: that
plus my own new file(s) and tests, still far under the 250 KB budget. Expected size delta is small
(a route entry, a few pure functions, one listener) but I will report the measured number, not an
adjective.

---

## 10. Open questions — for the repo owner

**These three change what gets built. I have not resolved any of them.**

### Q1. Should the hotkey support modifier chords, or follow the repo's existing single-key pattern?

All 11 existing bindings are bare `KeyboardEvent.code` values; nothing in `packages/**` reads a
modifier as part of a binding (5 grep hits, none a binding — `router.ts:138` and two Shift-Tab focus
traps). Supporting `opt+cmd+d` means adding a chord representation, chord capture and chord label
rendering *alongside* the single-key ones.

- **(a) Build chord support** for this one action. Delivers the requested default literally. Cost: a
  second binding shape next to the existing one — arguably the "parallel new pattern" the review
  criteria warn about, which is why I am asking rather than choosing.
- **(b) Bare-key default** in the existing pattern (e.g. `E`, which is free — it does not collide
  with any of the 11 defaults). Uniform with everything else; ignores the specific combo asked for.

*My recommendation, not my decision:* (a), because the request names the combo explicitly and a
one-key default for a destructive-ish navigation is easier to hit by accident. But (b) is the
answer that keeps one pattern in the repo, and that is the owner's call, not a cost question.

### Q2. ⌥⌘D is a macOS system shortcut — is that intended?

Apple documents **Option-Command-D: Show or hide the Dock**
(<https://support.apple.com/en-us/102650>). On macOS the window server normally claims it, so a
browser page would never see the keydown — the default binding could appear dead on exactly the
platform whose notation the request uses. **Unverified: no macOS available here.** The binding is
rebindable either way, so "ship ⌥⌘D anyway" is a perfectly fine answer — I just will not assume it.
If the owner wants a Mac-safe default instead, ⌥⌘E and ⌃⌥D are both unclaimed by macOS as far as I
can tell.

### Q3. "Reachable in settings" — the Settings screen, or the paused in-game menu?

- **(a) The `/settings` screen.** It can tell it was opened mid-game: the pause menu navigates with
  `state:{returnTo:<play path>}` (`play.ts:159-163`), read back at `settings.ts:168-169`, and
  `matchRoute` recovers the level id from it. Opened from the main menu there is no current level,
  so the row must be absent or inert — a slightly awkward, conditionally-present control.
  **Files: `ui/settings.ts` only — entirely within my lane.**
- **(b) The paused in-game menu** (`ingameMenu.ts:58-63`: Restart / Settings / Choose level / Main
  menu). A current level always exists there, so the control is unconditional and obvious. But
  "settings" is not what that menu is called, and it needs a callback threaded through
  **`hud/pause.ts` and `hud/index.ts` — T-09 GAUGE's files, outside the lane you drew.** I would
  need clearance before touching them.

*My recommendation, not my decision:* (b) reads like the better product and (a) reads like the more
literal parse of "in settings". Doing both is also coherent and costs little. I will not pick by
which is cheaper.

### Q4 — DECIDED, not escalated

**Decision: a fork keeps its source level's name. Nothing is auto-renamed.**

Taken rather than escalated, on the orchestrator's instruction. Recorded here so the consequence is
documented rather than reported later as a bug.

*The consequence, stated plainly:* open Stage 08 "Orbital Primer" in the editor, change something,
save — and Level Select now shows **two entries called "Orbital Primer"**, one on the built-in tab
and one on the custom tab. `buildLevelList` (`view-models.ts:44`) renders the two tabs from
`BUILTIN_LEVELS` and `storage.listCustomLevels()` independently and neither de-duplicates by name,
so nothing collapses or flags them. Saving the same fork twice produces two custom entries with the
same name as well, because `saveCustomLevel` appends unconditionally.

*Why leave it alone anyway:*

- The editor's properties panel already exposes name and author (`editor/panel.ts`, driven by
  `engine.setMeta`), so renaming is one field away and is the author's decision to make.
- `customLevelId` is `slug(name) + "-" + djb2(JSON.stringify(level))` (`core/level.ts:395`). An
  auto-appended "(copy)" changes the slug *and* the hash, so it changes the level's identity — the
  key its personal bests, its share link and its storage entry all hang off. Doing that silently, to
  make a cosmetic duplicate-name problem go away, is the worse trade.
- Any auto-rename scheme also has to answer "what about the second copy" — "(copy)", "(copy 2)" —
  which is a naming policy, and inventing one unasked is scope this feature has no mandate for.

If duplicate names in Level Select turn out to matter, the honest fix is in Level Select (show the
author, or mark forks), not in the id.

---

## 10a. Deviations from this plan, as built

Recorded rather than adapted quietly, per the procedure.

### First stage (scoped GO — route, seeding, persisted key)

1. **`resolveEditorTarget` was added to `view-models.ts`**, and `editorPlaceholder.ts` is a thin
   switch over its result. §3 described the screen doing the resolving itself. The reason is
   testability: `mountEditor` builds a canvas and a renderer, and there is no jsdom here, so the
   screen is only reachable from the browser pass — but the *decision* (blank / seeded / not-found)
   is exactly the part worth unit-testing. This is the split `view-models.ts`'s own header describes
   as the file's purpose. Same files, same behaviour.

2. **`readEditLevelHotkey` returns `string | null`, not a defaulted string**, and no
   `DEFAULT_EDIT_LEVEL_HOTKEY` constant exists yet. §9 test 13 said "absent → default". A default
   value cannot be written without choosing the binding *grammar*, which is Q1 and is gated — so the
   accessor commits only to "a string lives under this key" and the default arrives with the
   matcher. Test 13 asserts absent → `null` instead, plus a refusal for a non-string persisted
   value, which the defaulted version would have hidden.

3. **`ROUTES` is now exported from `app.ts`.** Not in the plan. The failing-first check showed that
   the new `router.test.ts` cases pass unchanged against a routing table that never gained the route
   — they assert against that file's own local fixture, which is a copy. They document the pattern;
   they do not cover the wiring. The export lets `edit-current-level.test.ts` assert on the real
   table. One added `export` keyword, no behaviour change.

4. **`router.test.ts`'s pre-existing `buildPath` round-trip test was re-keyed** from route *name* to
   route *pattern*, because `/editor` and `/editor/:levelId` deliberately share the name `editor`
   and the name stopped being unique. Strictly more coverage, not less: every route is now exercised
   rather than falling through to `{}`, and a new guard asserts the sample-param map covers every
   parameterised route.

### Second stage (full GO — chords, listener, pause-menu entry)

5. **`resolveHotkeyCapture` has three outcomes, not the two §5 specified.** `cancel` / `pending` /
   `bind`. A modifier key pressed on its own must not commit — otherwise holding Option binds Option
   the instant it goes down and a chord can never be entered. §9's test 6 already required exactly
   that behaviour, so the third state is what makes the approved test passable rather than a
   widening of it. Same function, same call site, one more case; judged not to be the "materially
   different shape" that warrants a re-submit.

6. **"Reset all controls to default" now also resets the editor hotkey.** Not in the plan. The
   hotkey renders as one more rebindable binding on that screen, so a Reset that skipped it would be
   a lie to the user. Additive — no existing setting changes meaning.

7. **`chordLabel` renders `"Unbound"` for a malformed binding**, rather than raw stored text.

8. **`applePlatform(hint)` was added** as a pure predicate so both label branches are testable; the
   single impure `navigator.userAgent` read lives at the Settings call site.

## 11. Risks

1. **Listener leak on the Play screen** — highest-consequence failure here, and a class this repo has
   already been bitten by (`input.ts:318-331`). Mitigated by teardown in `destroy()`, an explicit
   test, and a real-browser navigate-away check.
2. **Regressing the existing rebind UI** by generalising `settings.ts`'s `pending` state machine.
   Mitigated by moving the decisions into pure tested helpers and re-verifying all 11 bindings in a
   browser.
3. **macOS Meta-key quirk:** while ⌘ is held, macOS suppresses `keyup` for other keys, so
   `input.ts`'s `heldCodes` can go stale. In practice the hotkey navigates away immediately and
   `play.ts`'s teardown plus `window blur` clear it — but it is a real interaction between a
   Meta-containing chord and the existing input model, and I will check it is not observable.
4. **Discoverability of the fork semantics.** A player who opens Stage 08 in the editor may expect
   to be editing Stage 08. The editor's own save dialog already says "Saves a new custom level",
   which I think carries it; if not, that is a copy change inside `editor/` and therefore something
   I would bring back to you rather than take.
5. **Q1(a) adds a second binding shape** to a repo that has exactly one. If that is judged the wrong
   trade, the answer is Q1(b) — which is why it is a question and not a decision.
