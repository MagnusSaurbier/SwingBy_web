# T-04 · AURORA — Canvas renderer

**Area:** `packages/web/src/render` · **Depends on:** nothing · **Blocks:** T-05 FLYWHEEL, T-11 DRAFT

## Goal

Draw the game. Canvas 2D, no WebGL, no framework. The renderer is a pure function of the frame it is
handed — it owns no simulation state and never advances anything.

## Owned files

```
packages/web/src/render/index.ts
packages/web/src/render/*.ts        starfield, bodies, trail, prediction, overlays
```

## Reference

`reference/godot/scripts/GameWorld.gd` — the `_draw_*` methods and `_build_starfield`. Palette is already
ported into `constants.ts` as `COLORS` (frozen).

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#webrenderindexts--t-04-aurora).

## What to draw

| Layer | Notes |
|---|---|
| Starfield | Parallax background. Generate once, deterministically, from a fixed seed — must not shimmer between frames. |
| Bounds warning | Edge glow, intensity from `frame.boundsWarning` (0–1). |
| Suns | Core + halo, `COLORS.sunCore` / `sunHalo`. **`visible: false` suns are not drawn at all** — this is a gameplay mechanic, not an oversight. |
| Planets | Rotated by `body.angle`. Goal body gets the `COLORS.goal` capture ring at `goalRange`. |
| Trail | Up to `TRAIL_LENGTH` (5,000) points, fading toward the tail. |
| Prediction | Player track in `predictionPlayer`, planet tracks in `predictionPlanet`. |
| Force vector | Net gravity on the player, when `frame.forceVector` is non-null. |
| Ship | One of four rocket sprites by `boostType`, scaled by `ROCKET_SCALE`, rotated to `velocity.angle() + PI/2`. Distinct boosting sprite while thrusting. |
| Flash | Full-screen white at `frame.flash` alpha, for the out-of-bounds reset. |

## Performance

The trail is 5,000 points and the prediction is up to 1,000 samples, redrawn every frame. Budget
**under 4 ms per frame at 1080p** so the tick loop keeps its headroom.

- Do not allocate per frame. Preallocate point buffers and reuse them.
- One `Path2D` or one `beginPath`/`stroke` per polyline — never per segment.
- Handle `devicePixelRatio` in `resize()`, not by scaling in `draw()`.
- Skip work fully offscreen; at low zoom most of the trail is not visible.

## Sprites

Four rockets plus boost variants live in `reference/godot/images/` (`rocket1..4`, `rocket1_boost..`).
Copy them into `packages/web/public/`. The UI icons in that folder are **svgrepo** assets with
unconfirmed licensing — do not copy those; T-08 BRIDGE replaces them with inline SVG paths. See
DESIGN.md §9.

## Coordinates

World space is +x right, **+y down**, matching the level JSON. Do not flip. `worldToScreen` and
`screenToWorld` must be exact inverses — T-11 DRAFT hit-tests with them and off-by-a-half-pixel
errors make the editor feel broken.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `createRenderer` + the `Renderer` interface | `packages/web/src/render/index.ts` |
| 2 | Draw modules: starfield, bodies, trail, prediction, overlays | `packages/web/src/render/*.ts` |
| 3 | Rocket sprites copied over (**not** the svgrepo icons) | `packages/web/public/rocket*.png` |
| 4 | Dev harness page driving a scripted path | `packages/web/src/render/dev.html` |
| 5 | Screenshots of 3 levels, light and dark, in the PR | — |
| 6 | Measured frame time and a heap-profile screenshot | — |

## Definition of done

- [ ] Renders all 33 levels without visual artefacts
- [ ] Invisible suns are genuinely absent from the output — verified per level, not assumed
- [ ] **< 4 ms/frame at 1080p** with a full 5,000-point trail and prediction on — report the number
- [ ] Zero allocation in the steady-state draw path, shown by a heap profile
- [ ] `worldToScreen(screenToWorld(p)) === p` within 1e-9 across the full zoom range
- [ ] Crisp on a 2× display (no blurry canvas)
- [ ] Imports nothing from `game/`, `ui/`, or `hud/`; types only from `@swingby/core`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working without T-01

You do not need real physics. Build a fixture that hydrates a level and moves the player along a
scripted path; that exercises every draw path. Do not import `physics.ts`.

## How to verify

**1. Visual sweep across all 33 levels:**

```bash
npm run dev -w @swingby/web
# open http://localhost:5173/src/render/dev.html
```

Step through every level. Specifically confirm the **invisible suns on levels using them are not
drawn** — that is a gameplay mechanic, and rendering them silently ruins those puzzles.

**2. Frame time.** DevTools → Performance, record 10 s at 1080p with a full 5,000-point trail and
prediction enabled. Read the mean scripting time for `draw`. Must be under 4 ms; report the number.

**3. Allocation.** DevTools → Memory → Allocation instrumentation on timeline, 10 s of steady-state
drawing. The steady-state draw path must show no repeating allocation sawtooth.

**4. Transform inverse:**

```bash
npm test -w @swingby/web -- render
```

Property test `worldToScreen(screenToWorld(p)) === p` within 1e-9 across the zoom range.

**5. Retina.** Open on a 2× display and zoom to 400%. Text and circle edges must stay crisp — if they
blur, `devicePixelRatio` is being handled in `draw()` instead of `resize()`.
