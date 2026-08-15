# T-08 BRIDGE — thought log

Append-only. See notes/README.md for convention.

## 2026-08-15T05:00Z — plan + framework decision (before any code)

### Read, in order
README.md, PROJECT.md, INTERFACES.md, tasks/T-08-BRIDGE.md, reference/godot/scripts/UIBuilder.gd
(2168 lines, read in full across two pages), SceneController.gd (294 lines, full),
GameConstants.gd (full), packages/core/src/types.ts + constants.ts (frozen, full),
packages/web/src/storage/index.ts (T-10 VAULT, landed, full), notes/T-04-AURORA/log.md,
notes/T-10-VAULT/log.md, current scaffold (main.ts, index.html, vite.config.ts, package.json,
vercel.json, infra/size-check.mjs, root tsconfig.json).

### Framework decision — PLAIN TYPESCRIPT + DOM, hand-rolled router. No Svelte, no other UI lib.

Two independent reasons, either one sufficient alone:

1. **The session's own constraints foreclose Svelte mechanically.** Using Svelte requires an
   `@sveltejs/vite-plugin-svelte` entry in `vite.config.ts` and a new `devDependencies` entry in
   `packages/web/package.json`. Both files are explicitly off-limits for this session ("Do NOT edit
   vite.config.ts, packages/web/package.json, or any tsconfig — those stay T-14's"). There is no
   way to wire Svelte's compiler into the build without touching one of those, so the decision is
   not really a preference in this session — it is the only option that doesn't require a file I'm
   forbidden to touch. Recorded so a future session doesn't wonder why "my framework choice" reads
   as "no framework."
2. **Even without that constraint, it's the right call against the budget.** Bundle gate is a hard
   250 KB gzip for the WHOLE initial route, shared with core+render+game+ui. Svelte's compiled
   output has no runtime VDOM (unlike React), so it's not the worst case DESIGN.md warns about, but
   it's still a new dependency graph (compiler magic, its own reactivity primitives, potential
   transitive deps) for six fairly simple screens that are 90% "list of buttons and toggles." Plain
   DOM costs literally 0 KB of framework runtime — every byte in the ui/ bundle is content. T-04
   AURORA's precedent (3.15 KB gzip for the *entire* canvas renderer, hand-rolled, no framework)
   shows this codebase's convention is already "plain code beats a dependency" wherever it's viable,
   and six mostly-static screens is squarely viable.

Router: hand-rolled, ~100 lines, matching `SceneController.gd`'s own line count for the same job
(294 lines total for router+scene lifecycle, and it does more than routing). Real URLs via
`history.pushState`/`popstate`, per the task doc ("Real URLs — this is a large part of why we are
not shipping WASM. ... If you find yourself writing a BASE_PATH constant, delete it."). No hash
routing.

### Testing constraint discovered — no jsdom/happy-dom installed

`npm ls` / node_modules confirms neither is installed (they're vitest peerDeps, optional, unmet).
T-04/T-06/T-10 all avoided it by hand-rolling minimal doubles (fake canvas, fake EventTarget, fake
localStorage) rather than requesting a new dependency. I can't edit `packages/web/package.json` to
add jsdom anyway. Plan: split UI code into (a) pure logic — route matching/building, level-list
view-models, rebind key resolution, settings-patch helpers — tested with plain `vitest run`, no DOM
needed; (b) DOM-rendering glue (screens/*.ts, app.ts) — not unit tested against a fake DOM (not
worth hand-rolling a DOM double for six screens' worth of markup); verified instead by driving real
headless Chromium (Playwright globally installed at `/opt/node22/lib/node_modules/playwright`,
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, confirmed present, same pattern T-04/T-06/T-07 used)
against the actual dev/preview server for keyboard nav, screenshots, persistence, and deep links.
`createStorage()` itself degrades to an in-memory backing store when `localStorage` is undefined
(confirmed by reading its source), so pure-logic tests can use the REAL `createStorage()` under
plain-Node vitest without any DOM at all — no need to hand-write a Storage fake for that part.

### Scope boundary on the `/play/:levelId` route — read carefully, this is a real ambiguity resolved deliberately

Task doc DoD literally says: **"No import from `game/loop.ts` or `render/`."** This directly
forbids me from creating a real `GameSession` or `Renderer` on the Play route, which seems to
conflict with routing needing to "load that level." Resolution, cross-checked against the task
doc's own framing ("Every screen that is **not** the game itself. ... it touches nothing the
simulation cares about") and INTERFACES.md (no documented contract connecting `main.ts` to
`hud/**`, and T-09 GAUGE — which owns `hud/**` and depends on T-05's interface per the root
README's dependency table — is the task that actually wires canvas+session+HUD together, not T-08):

**`/play/:levelId` in my router is a routing/chrome placeholder, not a gameplay mount.** It resolves
the level from `BUILTIN_LEVELS`/`levelId()` (or custom levels via `customLevelId()`), shows a
header (name/author/index) and a labelled, stably-classed mount point
(`<canvas class="play-canvas" data-swingby-game-mount>`) for T-05/T-09 to attach to later, and
hosts my "in-game menu" component (the actual T-08 deliverable) triggered by Escape or an on-screen
button — using placeholder telemetry, since no simulation is running. This satisfies: the DoD's
import ban (literally true — grep will confirm), "loads that level on cold load" (level identity
resolves and renders, which is what the task doc's own verification step checks — a fresh tab
render, not a running simulation), and gives me a legitimate way to demo/screenshot the six required
screens including "in-game menu" without a physics engine. Documenting this explicitly because it's
the single highest-risk interpretation call in this task — if a later reviewer disagrees, this is
where to start.

### Routing table — the task doc only lists 4 canonical paths; I'm adding 4 more for deep-linkability

Task doc's routing section lists `/`, `/play/:levelId`, `/editor`, `/l/:shareId` only. But the
Screens table separately says "Level Select ... Deep-linkable," which needs its own path that the
routing table omits. Rather than treat Level Select as reachable only via in-app nav (which is what
a Godot-style single-page-with-hidden-panels app would do, and is clearly NOT what "Real URLs" is
going for), I'm giving every screen a real path:
`/`, `/levels`, `/workshop`, `/settings`, `/credits`, `/play/:levelId`, `/editor`, `/l/:shareId`.
This is additive, not a deviation from the documented 4 — those 4 still work exactly as specified.

### Settings "return to caller" (task doc: "Opening Settings from here returns *here*, not to the
main menu") — implemented via `history.pushState`'s `state` object (`{ returnTo: <path> }`), read
back by the Settings screen's Back button and by the popstate handler. Not a query param (avoids
polluting the shareable/canonical `/settings` URL with navigation-internal state).

### Icons (deliverable 4) — hand-authored inline SVG paths in `ui/icons.ts`, no external set, no
sprite sheet, no icon font. Covers back/play/pause/restart/home/grid/gear/rocket/info/close/check —
a fresh, small icon set that covers what my 6 screens actually need (not a 1:1 port of the 7
svgrepo files UIBuilder.gd references, several of which — save, trash — belong to the editor, T-11's
scope, not mine).

### Design tokens (deliverable 3) — CSS can't `import` a `.ts` const, so `styles/tokens.css` hand-
transcribes the exact numeric values from `COLORS` in constants.ts (documented per-token in a
comment mapping each CSS var back to its `COLORS` field) rather than inventing new hues. UI chrome
colors (panel backgrounds, borders, focus rings) that have no equivalent in `COLORS` (a
gameplay-element palette, not a UI-chrome one) are new tokens built around the two accents COLORS
does define (cyan from `trail`/`goal`, amber from `sunCore`), eyeballed against UIBuilder.gd's own
near-black panel values (`Color(0.04, 0.08, 0.15, ...)` etc., read for visual direction only, not
ported as code, per the task doc's explicit instruction).

### Theme — committing to a single dark theme, deliberately, stated here and in results.md. The
task doc permits this explicitly ("Light and dark both handled, or one committed to deliberately
and stated"). Reasoning: this is a space game inheriting a near-black cyan/amber palette from the
Godot original; the personal-site shell around it (light, Roboto) is explicitly said not to need
matching ("The game does not need to match it").

### Plan (in order)
1. `ui/router.ts` (+ tests) — pure path matching/building + a thin imperative wrapper over
   `window.history`/`popstate`.
2. `ui/icons.ts` (+ tests) — inline SVG.
3. `styles/tokens.css`, `base.css`, `components.css`, `screens.css`, `index.css`.
4. `ui/view-models.ts` (+ tests) — level list, first-incomplete-level, rebind key resolution,
   control-code display labels. Pure, no DOM.
5. `ui/screens/*.ts` — menu, levelSelect, workshop, settings, credits, ingameMenu, play (placeholder
   per above), editor (placeholder, T-11's real screen), shared (placeholder, T-13's real screen),
   notFound.
6. `ui/app.ts` — root shell wiring router + screens + storage.
7. `main.ts` (framework-decision comment at top, deliverable 5) + `index.html`.
8. `npm run typecheck`, `npx vitest run` on my files, fix.
9. Manual verification pass: dev server, headless Chromium — keyboard nav, screenshots (12: 6
   screens × 2 widths), persistence round-trip, deep link cold load, break/restore a test.
10. `results/T-08-BRIDGE.md`.

Nothing written to disk yet as of this entry except this log. Starting on router.ts next.

## 2026-08-15T05:10Z — all code written, typecheck clean, unit tests green, build under budget

Wrote, in order: `ui/router.ts` (+16 tests), `ui/icons.ts` (+5 tests, 14 icons: back/play/pause/
restart/home/grid/gear/rocket/info/close/check/chevronRight/edit/link), `styles/{tokens,base,
components,screens,index}.css`, `ui/view-models.ts` (+14 tests: level list, first-incomplete,
resolveLevel, rebind key resolution, codeLabel, formatMs), `ui/dom.ts` (h()/append/text/fromMarkup/
trapFocus — DOM construction sugar, explicitly not a framework, see its header comment), `ui/
screen.ts` (ScreenCtx/ScreenResult contract), `ui/chrome.ts` (screenHeader/backLink/iconedButton —
shared markup fragments, not a widget factory), `ui/screens/{menu,levelSelect,workshop,settings,
credits,ingameMenu,play,editorPlaceholder,sharedPlaceholder,notFound}.ts`, `ui/app.ts` (router+
screen wiring), `main.ts` (framework-decision header, deliverable 5), `index.html`.

**Design decisions made while writing, not already in the pre-code plan above:**
- Workshop's craft selection and Settings' rebind/toggle interactions deliberately do NOT call
  `ctx.rerender()` — a full screen rebuild would drop keyboard focus off whatever the user just
  activated (new DOM subtree = old focused element is gone), which is exactly what the keyboard-
  only pass is supposed to catch. Both screens mutate the existing DOM in place instead
  (`textContent`, `aria-pressed`, `checked`) and persist to storage directly. `ctx.rerender()` still
  exists on the context (used by app.ts internally for route changes) but no screen body actually
  calls it — noting this in case a future reader wonders why it's unused outside app.ts.
- `Settings["controls"]` cast friction: hit the exact same frozen-type issue T-10 VAULT's log
  already documented (constants.ts's `Settings["controls"]` intersection infers each key at
  DEFAULT's literal type) — same fix, an explicit cast at the one `persistControls()` call site,
  commented with a pointer to T-10's log entry rather than re-deriving the explanation.
- `createInputSource(document.body)` is instantiated for the lifetime of the Settings screen purely
  to call `.setBindings()` (DoD requirement) and `.destroy()`'d on unmount; confirmed by reading
  input.ts's own header comment that this module deliberately has no rebind-session API and expects
  the caller (me) to own "listen for the next keydown" — my design matched before I even read to
  confirm, which is a good sign, but reading confirmed it rather than assumed it.

**Verification so far, as numbers:**
- `npx tsc --noEmit -p tsconfig.json` (whole repo): 0 errors. `npm run typecheck` (root contracted
  `tsc --build --force`): 2 pre-existing errors in `api/test/_ratelimit.test.ts` (T-12 LEDGER's
  in-progress file, not touched by me, matches the coordinator's "ignore those" note) — exit code 0.
- `npx vitest run packages/web/src/ui`: **3 files, 35/35 tests passed** (16 router + 5 icons + 14
  view-models). The `[swingby/storage] localStorage unavailable...` stderr lines in view-models.test
  output are T-10 VAULT's own designed-in warning (real `createStorage()` degrading to in-memory
  under plain-Node vitest, no jsdom) — expected noise, not a failure.
- `npm run build -w @swingby/web`: succeeds. **Output: index.html 0.58 KB gzip + CSS 2.84 KB gzip +
  JS 12.24 KB gzip.**
- `npm run size`: **15.64 KB gzip total, 234.36 KB under the 250 KB budget.** Framework-choice
  payoff stated as a number, not an adjective, per the global DoD rule.

**Not yet done (next steps, in order):** manual browser verification pass (dev server + headless
Chromium per the pattern in notes/T-04-AURORA/log.md: global playwright install, `/opt/pw-browsers/
chromium`) — 12 screenshots (6 screens × 1280px/360px), keyboard-only pass per screen, persistence
round-trip through real storage + reload, deep-link cold load via `vite preview` (built dist, SPA
fallback), corrupt-storage-key resilience check, break/restore a test for the red→green proof, then
`results/T-08-BRIDGE.md`. About to start the dev server next — logging this now per the "log
immediately before anything slow/risky" cadence rule.
