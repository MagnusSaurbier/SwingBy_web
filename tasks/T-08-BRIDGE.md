# T-08 · BRIDGE — UI shell: menu, level select, settings, workshop, credits

**Area:** `packages/web/src/ui` · **Depends on:** T-10 VAULT *(interface only)* · **Blocks:** nothing

## Goal

Every screen that is not the game itself. This is the largest task by surface area and the easiest
to parallelise against, because it touches nothing the simulation cares about.

## Owned files

```
packages/web/src/ui/**
packages/web/src/main.ts          app entry + router
packages/web/index.html
packages/web/src/styles/**
```

**You own the framework decision** for this layer (Svelte, or plain DOM with a small router). It must
not leak into `core/`, `render/`, or `game/` — those stay framework-free. Record the choice and the
reason at the top of `main.ts`.

## Reference

`reference/godot/scripts/UIBuilder.gd` (2,168 lines) and `SceneController.gd` (294 lines).

**Read these for *what screens exist and what is on them*, not for how they are built.** UIBuilder is
imperative widget construction — `make_screen_shell`, `make_level_card`, `accent_panel_style` — and
essentially all of it evaporates in HTML and CSS. Do not port it line by line. If you find yourself
writing a `makeButton` helper, stop; that is a `<button>` and a stylesheet.

## Screens

| Screen | Contents |
|---|---|
| Menu | Title, Play (resumes at first incomplete level), Level Select, Editor, Workshop, Settings, Credits |
| Level Select | Grid of 33 built-in levels + custom levels. Completion state, personal bests when `showTimes`. Deep-linkable. |
| Workshop | Preview and pick one of four rocket variants. Persists as `boostType`. |
| Settings | Username, all display toggles (`trail`, `showFps`, `showHighscores`, `showTimes`, `showFuture`, `showForceVector`), and the control rebinding list |
| Credits | Attribution |
| In-game menu | Resume, Restart, Settings, Level Select, Main Menu. Opening Settings from here returns *here*, not to the main menu. |

## Routing

Real URLs — this is a large part of why we are not shipping WASM.

```
/                     menu
/play/:levelId        a level
/editor               editor
/l/:shareId           shared custom level
```

The game lives on its **own subdomain**, `swingby.magnussaurbier.de`, so routes are rooted — there is
no base path to thread through the router. If you find yourself writing a `BASE_PATH` constant,
delete it.

## Icons

`reference/godot/images/` contains svgrepo SVGs (`back-`, `play-`, `pause-alt-`, `save-`, `stop-`,
`trash-xmark-alt-`, `leave-`) with **unconfirmed licensing**. Do not ship them. Replace with inline
SVG paths you author or take from a known-licensed set (Lucide, MIT). Rocket PNGs are fine — those
are original project assets and T-04 AURORA handles them.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | App entry and router | `packages/web/src/main.ts`, `packages/web/index.html` |
| 2 | Six screens: menu, level select, workshop, settings, credits, in-game menu | `packages/web/src/ui/**` |
| 3 | Stylesheet and design tokens from `COLORS` | `packages/web/src/styles/**` |
| 4 | Replacement inline SVG icons (**not** svgrepo) | `packages/web/src/ui/icons.ts` |
| 5 | Framework choice + reason, at the top of `main.ts` | — |
| 6 | Screenshots of every screen at 1280 px and 360 px, in the PR | — |

## Definition of done

- [ ] Every screen reachable and fully navigable by keyboard alone
- [ ] Settings changes persist across reload via T-10 VAULT
- [ ] Rebinding UI drives `InputSource.setBindings`; pending binds are cancellable
- [ ] Deep links work: `swingby.magnussaurbier.de/play/builtin-07` loads that level on cold load
- [ ] Back/forward buttons behave correctly
- [ ] Usable at **360 px wide** — this game is meant to be played on a phone
- [ ] Light and dark both handled, or one committed to deliberately and stated
- [ ] Lighthouse accessibility **≥ 95** on menu and level select
- [ ] **No svgrepo asset ships** — `grep -ri svgrepo packages/web/` is empty
- [ ] No import from `game/loop.ts` or `render/`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Visual direction

The palette is in `constants.ts` as `COLORS` — cyan/amber on near-black, already consistent with the
Godot build. The personal site it will live under (`magnussaurbier.de`) is restrained: Roboto Light,
generous whitespace, one accent. The game does not need to match it, but the seam between them
should not be jarring.

## Working without dependencies

Stub `Storage` with an in-memory object and `BUILTIN_LEVELS` with a hand-written array of three. The
entire shell is buildable and demoable before any other task lands.

## How to verify

```bash
npm run dev -w @swingby/web        # http://localhost:5173
npm run typecheck
```

**1. Keyboard-only pass.** Unplug the mouse. Reach every screen, change every setting, start a
level, and return to the menu using only Tab, arrows, Enter, and Escape. Anything unreachable fails.

**2. Deep links on cold load.** Not navigation — paste the URL into a fresh tab:

```
http://localhost:5173/play/builtin-07
http://localhost:5173/editor
```

Both must render directly. If they 404, the SPA fallback is missing — coordinate with T-14.

**3. Responsive.** DevTools device toolbar at 360 × 640. Every screen usable, no horizontal scroll,
no clipped controls. Then check the level select grid at 1440 px — it should not become a row of
lonely cards.

**4. Licensing check** — mechanical, and a release blocker:

```bash
grep -ri "svgrepo" packages/web/ ; echo "(empty = clean)"
```

**5. Accessibility.** Lighthouse on menu and level select, ≥ 95. Fix what it reports rather than
arguing with it; at this size the findings are almost always real.

**6. Persistence.** Change username and three toggles, hard-reload, confirm all four survived. Then
corrupt the storage key in DevTools and reload — the app must still start (T-10's contract, but this
is where you would notice it broken).
