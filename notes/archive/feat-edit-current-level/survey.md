# feat/edit-current-level — requirement + code survey

Request, verbatim from the repo owner:

> New feature reachable in settings and through selectable hotkey (defaults to opt+cmd+d):
> The currently played level will be opened in the level editor.

No code written. This file records what the code actually says, what that forces, and what is
still genuinely ambiguous. Every claim below cites the file and line I read it in.

## Baseline measured on this branch's merge-base (`5ceb841`)

| Gate | Result |
|---|---|
| `npm run typecheck` | clean (`tsc --build --force`, no output) |
| `npm test` | **56 files, 847 passed, 1 skipped** |
| `npm run lint` | `All matched files use Prettier code style!` |
| `npm run build -w @swingby/web` + `npm run size` | **PASS — 40.55 KB gzip** (raw 127.40 KB, budget 250 KB) |

Matches the orchestrator's stated baseline (it quoted 40.56 KB; the checker prints 40.55 KB).

## 1. The editor already accepts a seed level — nothing calls it that way

- `editor/editor.ts:807` `EditorMountOptions { storage; level?: Level; onExit?; onSaved?; api? }`
- `editor/editor.ts:888` passes `initialLevel: opts.level` into `createEditorEngine`
- `editor/editor.ts:215-222` when `initialLevel` is present it `hydrate()`s it and takes its
  bodies, `goalIndex`, `goalRange`, `name`, `author`; otherwise it starts empty at "Custom Stage"

The only call site is `ui/screens/editorPlaceholder.ts:14`, which passes **no** `level`, and says so
explicitly at `:22-23`:

> No `/editor/:levelId` route exists yet for editing an existing custom level — every visit starts
> a fresh, empty level. `ctx.params` is intentionally not consulted here.

So the seeding plumbing is already built and signposted as an intended extension point. This
feature is a route + entry points, not new editor internals.

## 2. "The currently played level" — three entry paths, not one

`ui/app.ts:23-32` routing table. Gameplay is reachable two ways:

- `/play/:levelId` → `ui/screens/play.ts:56` → `resolveLevel(levelIdParam, customs)`
  (`ui/view-models.ts:78`), which resolves **built-ins** (`levelId(i)` = `builtin-NN`) and
  **local customs** (`customLevelId(level)`).
- `/l/:shareId` → `ui/screens/sharedPlaceholder.ts` → the same `mountPlayLevel`, with a level
  **fetched from the API**. It has no local id and `resolveLevel` cannot address it.

A `/editor/:levelId` route therefore covers the first path exactly and cannot cover the second.

## 3. Saving from the editor always *forks* — it cannot edit in place

- `storage/index.ts:305-307` `saveCustomLevel(level)` → `persistCustomLevelsOrThrow([...cache, level])`.
  Append-only. There is no update and no overwrite anywhere in `Storage`.
- `editor/editor.ts:959-981` the Save button's own confirm dialog reads
  *"Saves a new custom level to this browser's storage."*
- `core/level.ts:395` `customLevelId(level) = slug(name) + "-" + djb2(JSON.stringify(level))` — the
  id is derived from content, so any edit is a new id by construction. `level.ts:388-392` states
  this outright: "renaming or editing a custom level changes its id... this id is NOT durable
  identity".

Consequence: "open the played level in the editor" is inherently **fork a copy**. Built-in stages
can never be modified; editing a *custom* level and saving leaves the original in the list too.

## 4. The hotkey is the hard part — and the repo has no mechanism for a chord

- `game/input.ts:33-37`: bindings are `KeyboardEvent.code` strings, one physical key per action.
- `game/input.ts:176-190` `onKeyDown` looks up `event.code` in a code→action map. It reads
  `event.repeat` and nothing else. **No modifier is consulted anywhere.**
- `ui/view-models.ts:137-143` `resolveRebindKey` returns `event.code` (or `{cancel:true}` on
  Escape). `ui/view-models.ts:108` `codeLabel` renders exactly one key.
- Repo-wide grep for `metaKey|altKey|ctrlKey|shiftKey` in `packages/**/*.ts` returns 5 hits, none
  of them a binding: `ui/router.ts:138` (don't SPA-intercept modified clicks) and two focus traps
  (`ui/dom.ts:97`, `editor/dialogs.ts:54`) reading `shiftKey` for Shift-Tab.

So `opt+cmd+d` cannot be expressed by the existing binding system at all.

### 4a. …and the natural place to add the action is frozen

- `core/constants.ts:71-85` `DEFAULT_CONTROLS` (11 actions) and `ControlAction = keyof typeof
  DEFAULT_CONTROLS`; `:87-99` `DEFAULT_SETTINGS` / `Settings`.
- `core/constants.ts:1-7` header: **"FROZEN CONTRACT"**. `INTERFACES.md:19` lists
  `types.ts, constants.ts` as **"frozen — nobody"**. `AGENTS.md` Rule 2: *"Never edit them. If you
  believe one is wrong, say so in your PR and work around it — do not change it."*

Adding an `editLevel` entry to `DEFAULT_CONTROLS` is therefore **not available to me**. AGENTS.md
answers this one directly: work around it.

### 4b. There is a supported way to work around it

`storage/index.ts:162-175` `mergeSettings` is `{...DEFAULT_SETTINGS, ...stored, controls:
{...defaultControls, ...storedControls}}` — a deliberate **preserve-unknown** merge at both levels
(its own comment explains the inner merge). An unrecognised settings key survives a
load→save→load round trip untouched, so a new hotkey field can be persisted without editing any
frozen file. `Settings`'s *type* still doesn't have the key, so the field needs to be declared and
cast in `ui/` — the same friction `settings.ts:93-100` already documents for `controls`.

### 4c. ⌥⌘D is a macOS system shortcut

Apple's own shortcut list gives **Option-Command-D: Show or hide the Dock**. It is claimed by the
window server, so a browser page will normally never receive the keydown on macOS. I cannot test
this — this container is Linux, with no macOS and no Mac keyboard. Reported, not verified.

## 5. Where "settings" could mean

- `/settings` (`ui/screens/settings.ts`) is reachable from the main menu **and** from the paused
  in-game menu, which navigates with `state: {returnTo: <play path>}` (`ui/screens/play.ts:159-163`)
  and is read back at `settings.ts:168-169`. So the Settings screen *can* tell it was opened
  mid-game, and from which level — but only in that case.
- The paused overlay itself (`ui/screens/ingameMenu.ts:58-63`: Restart / Settings / Choose level /
  Main menu, wrapped by `hud/pause.ts`) is where a "current level" always exists.

## 6. Other constraints found

- The editor is **desktop/mouse only** — `editor/editor.ts:832-834` renders a permanent note
  "Desktop / mouse only — touch input is not supported in the editor."
- Navigating away destroys the play session: `ui/app.ts:88-89` calls `destroyCurrent()` before
  rendering the next screen, and `play.ts:319-331` tears down session, gauge, input and audio. Any
  in-flight attempt is lost when the editor opens.
- File ownership (`INTERFACES.md:13-34`): `ui/**` is T-08 BRIDGE, `editor/**` is T-11 DRAFT,
  `hud/**` is T-09 GAUGE, `game/input.ts` is T-06 HELM.
- No jsdom in this repo — DOM-level behaviour is tested through hand-written fakes
  (`hud/__tests__/fakeDom.ts`, `editor/__tests__/fakes.ts`) or asserted on CSS rule text
  (`test/ui-toggle-css.test.ts`); pure logic lives in `ui/view-models.ts` and is unit-tested in
  `ui/__tests__/view-models.test.ts`.
