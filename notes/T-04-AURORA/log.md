# T-04 AURORA — thought log

## 2026-08-13T09:56Z — backfill: research done before first pause

Read in order: README.md, PROJECT.md, INTERFACES.md, tasks/T-04-AURORA.md,
reference/godot/scripts/GameWorld.gd (full), reference/godot/scripts/HUDController.gd (full),
grepped PhysicsEngine.gd for rocket_angle_from_velocity and GameConstants.gd for color consts.
No code written yet at time of this entry — about to start `packages/web/src/render/`.

### Reference findings (GameWorld.gd)

- `_draw()` (line 467) draw order, which I'm replicating: background/starfield → predictions →
  trail → goal ring → objects (suns, planets, player) → particles → force vector (only if
  `show_force_vector` setting, gated by mode) → editor overlay (not my concern, T-11 passes
  `editorOverlay` opaquely) → bounds warning border → reset flash. **I will follow this same
  z-order**, it's load-bearing for correctness (e.g. bounds warning must sit above everything).
- `world_to_screen` (line 508): `viewport_center + (world_pos - world_origin) * zoom + shake_offset`.
  `screen_to_world` (line 485) is the exact algebraic inverse, ignoring shake (shake is camera
  jitter, presentation-only, and Godot's own screen_to_world does NOT invert the shake term either
  — consistent with what I need: shake must not appear in my Renderer at all, since `Camera` in
  INTERFACES.md is just `{x, y, zoom}`, no shake field. So my worldToScreen/screenToWorld are pure
  functions of `Camera` with no hidden state — that's what makes them exact inverses for T-11's
  hit-testing.)
- Camera semantics: `camera.x/y` in our frozen `Camera` interface = Godot's `world_origin` (the
  world point mapped to viewport center), NOT the top-left of a viewport rect. `camera.zoom` = Godot's
  `zoom_factor`. My `worldToScreen(p, camera)` needs a viewport-center offset too, which isn't part
  of `Camera` — the renderer's own canvas CSS size (from `resize()`) supplies that. So `resize()`
  must store cssWidth/cssHeight (and dpr) as internal renderer state, and worldToScreen/screenToWorld
  read that stored viewport size. This is the one piece of state the renderer legitimately owns
  (viewport dimensions), separate from "gameplay state" which rule #6 forbids caching.
- Sun draw (line 810-815): only if `visible` — three concentric circles, radius*3 halo (very
  transparent), radius*1.8 mid (fixed color 1,0.78,0.28,0.28 — NOT in COLORS constant, so I'm
  hardcoding this one same as Godot does inline), radius*1 core. Invisible suns still simulate
  (physics) but genuinely skip all three draws — confirmed nothing else references them in `_draw`.
- Planet draw (line 816-823): draws `earth_texture` (a single fixed earth.png reused for every
  planet, scaled to `planet_size*2 / texture.width`, rotated by `obj.angle`) plus a translucent
  backing circle. Texture asset not in my copy list per task doc's Sprites section (only rockets are
  named) — decision below.
- Player draw (824-832): HUD glow circle (`44*scale`, `COLORS.hudGlow`) THEN the rocket sprite,
  boost variant selected by `is_boosting`, `draw_set_transform(pos, angle, scale)` +
  `draw_texture(tex, -tex.size*0.5)` i.e. sprite is drawn centered, image's own "up" direction is
  the ship's nose. `ROCKET_SCALE = 0.17` from constants.ts, multiplied by zoom.
- Rocket angle (PhysicsEngine.gd:215): `velocity.length_squared() <= 1e-6 ? 0 : velocity.angle() + PI/2`.
  Godot's `Vector2.angle()` is `atan2(y, x)` in Godot's y-down space. Canvas `ctx.rotate(theta)` is
  also clockwise-positive in a y-down canvas coordinate system, so `atan2(vy, vx) + PI/2` used
  directly with `ctx.rotate` reproduces the same visual rotation without any axis flip. This is
  presentation-only per PROJECT.md (rendering may diverge from strict physics parity), but I'm
  matching it anyway since it's cheap and correct.
- Force vector (845-855): `origin = player screen pos`, `vector = (xAcc, yAcc) * 2200 * zoom`,
  skip draw if `vector.length() < 0.5`. Frame's `forceVector: Vec2 | null` in our interface is
  already the raw acceleration-like vector (world units) — I apply the same `*2200*zoom` scale in
  screen space, matching Godot's visual magnitude.
- Goal ring (765-774): pulsing radius via `sin(_goal_flash*3)*0.08`, where `_goal_flash` is a
  free-running `elapsed_time`-like clock (`_goal_flash += delta` every process frame, never reset
  except level load). RenderFrame has no clock field, so I can't reproduce the sin-pulse
  deterministically from frame data alone. **Decision: use `performance.now()/1000` internally in
  the renderer only for this cosmetic pulse** — this does NOT violate "stateless w.r.t. gameplay"
  (rule #6) because it's not derived from `world`/`trail`/`prediction`, it's wall-clock cosmetic
  animation exactly like Godot's own `_goal_flash` free-runs off `delta`, independent of simulation
  ticks. Documented as an intentional, narrow exception.
- Bounds warning (777-792): I only get `frame.boundsWarning: 0-1` (a single number), not Godot's
  two-phase `_bounds_warning_level` (proximity) vs `_bounds_warning_timer` (countdown-to-reset)
  which it `maxf()`s together into one `intensity` before drawing. Our frozen `RenderFrame` collapses
  that into one number already — T-05 FLYWHEEL's job, not mine. I just draw the two rects (glow at
  2x border width, then border) with alpha `0.08 + intensity*0.36 + pulse*0.14*intensity`, pulse
  from the same wall-clock cosmetic timer as the goal ring.
- Reset flash (795-800): full-viewport rect, `Color(1,0.08,0.06,0.42*progress)`. Our `frame.flash`
  is already 0-1 (T-05 tracks the progress/countdown), so I just do
  `rgba(255,20,15, 0.42*flash)` — no internal timer needed here, unlike bounds-warning pulse.
- Starfield (858-872): 3 layers, 46+18*layerIndex stars each, parallax 0.06+0.08*layerIndex,
  positions randomized ONCE at `_build_starfield()` (called once in `_ready()`), then in
  `_draw_background` each star's screen pos = `base_pos - player_offset*parallax`, wrapped into
  the viewport with `wrapf(..., -32, viewport+32)`. So: generate star field once with a **seeded**
  RNG (task doc explicitly says "fixed seed, must not shimmer between frames" — Godot uses real
  `randf()` seeded by wall-clock per-session, which is fine for them since it's regenerated once
  per app launch and never redrawn from a different seed mid-session; but our renderer is stateless
  across `draw()` calls with no `_ready()`-equivalent lifecycle hook in the `Renderer` interface —
  **decision: generate the starfield lazily on first `draw()` call and cache it in module/closure
  state keyed by nothing (one starfield for the renderer's lifetime), from a fixed numeric seed
  (not Math.random)** so two renderer instances (or two test runs) are pixel-identical, and repeat
  `draw()` calls never regenerate it. This is the one other piece of legitimate renderer-owned
  state (identical justification to viewport size: it's presentation infrastructure, not gameplay
  state derived from `world`).

### Decisions made, not yet fully implemented

1. **No earth.png for planets.** Task doc's Sprites section only lists the four rockets +
   boost variants for copying; planets are drawn procedurally (radial-gradient sphere + a
   rotating terminator/highlight arc driven by `body.angle` so rotation is still visually
   verifiable) instead of texturing with Godot's shared earth.png. Avoids a 5th binary asset and
   keeps "Rotated by body.angle" faithful without needing a texture I wasn't told to copy.
2. **Asset location:** hard rule #3 in my brief ("copy any image you need into a path you own
   under packages/web/src/render/") overrides the task doc's `packages/web/public/rocket*.png`
   path (that predates this environment's stricter file-ownership rule, and `public/` isn't in
   ANY task's ownership row in INTERFACES.md). Copying to
   `packages/web/src/render/assets/rocket*.png` instead, referenced via
   `new URL('./assets/...png', import.meta.url)` — native ESM, works both under Vite and in a
   plain browser without bundler-specific config, so it doesn't depend on anything T-14 decides
   later.
3. **Bundle-budget interaction with images resolved by reading `infra/size-check.mjs` (T-14's
   already-landed script, read-only for me): it explicitly scopes the 250 KB gzip budget to
   `.js/.mjs/.css/.html` in the build output and says static binary assets (rocket sprites,
   named explicitly!) are NOT counted.** So shipping 8 PNGs (~209 KB raw total, confirmed via
   `node` PNG IHDR read since PIL wasn't installed) as separate files is fine; embedding them as
   base64 inside a .ts module would NOT be fine (that inflates the counted JS). Confirms decision
   #2's file-based (not inlined) approach is required, not just preferred.
4. **Trail fade** (task doc says "fading toward the tail", which the actual Godot `_draw_trail`
   (line 754) does NOT do — it's a single flat-color polyline). Since PROJECT.md explicitly says
   rendering may diverge from Godot ("Determinism" section: rendering/audio are outside the
   physics-parity contract), I'm implementing the task doc's fade literally, but for the perf
   budget ("one beginPath/stroke per polyline — never per segment") I'm chunking the 5,000-point
   trail into ~24 alpha buckets (one stroke() call each, overlapping by one point so there's no
   visible seam) rather than one stroke per point. This is not literally "one stroke for the whole
   polyline" but respects the actual intent (avoid O(n) draw calls); documented here so a reviewer
   understands it's deliberate, not an oversight of the "never per segment" rule.
5. **Prediction dots**: build one `Path2D`, append an `arc()` per sample point into it, single
   `fill()` call — not one `fill()` per point. Up to 1000 (player) + planet tracks.

### Environment / tooling findings (this pause cycle)

- `packages/web` did not exist at all when I started (only `packages/core`). T-14 has since landed
  it — confirmed via re-read just now: `packages/web/package.json`, `vite.config.ts`, `index.html`,
  `src/main.ts` are real and functional (`@swingby/core` resolves via npm workspace symlink at
  `node_modules/@swingby/core -> packages/core`). `src/render/` does not exist yet — nothing of
  mine is on disk yet.
- No jsdom in node_modules (`require.resolve('jsdom')` fails) and no vitest workspace config
  present, so vitest's default environment is plain Node — `HTMLCanvasElement`, `Image`, `document`
  are all `undefined` at module scope. Confirms the brief's instruction to use a fake 2D context is
  not optional convenience, it's the only way tests run at all right now. **Implication for
  sprites.ts: must NOT call `new Image()` or touch `document` at module top-level or inside
  `createRenderer()` unconditionally** — guard with `typeof Image !== "undefined"` (or defer
  construction into a function only called from real `draw()` with a real canvas) so importing the
  module under plain-Node vitest doesn't throw before a single test runs.
- Playwright is not a project devDependency but IS installed globally
  (`/opt/node22/lib/node_modules/playwright`, v1.56.1), and Chromium is preinstalled at
  `/opt/pw-browsers/chromium` per the environment brief. Plan: use `node` with
  `NODE_PATH=/opt/node22/lib/node_modules` (or an absolute require path) to pull in the global
  playwright package for the screenshot harness script, rather than adding it as a project
  dependency (which I'm not allowed to do — no package.json edits).

### Open questions / assumptions flagged

- `RenderFrame.editorOverlay?: unknown` — confirmed opaque, pass through untouched, never
  interpreted. No code reads it in my planned draw order (draw order above has no editor-overlay
  step at all in the base renderer — T-11 DRAFT presumably renders it separately on top, or a
  future interface revision adds a hook; not my problem per the brief).
- Assuming `Camera.zoom` can be very small/large (editor zoom range in Godot is 0.12–5.0) — my
  round-trip test sweep should cover that range plus extremes near it, not just 0.5–2.

### Next step (as of this entry)

About to write `packages/web/src/render/transform.ts` (worldToScreen/screenToWorld, viewport-size
state) first since everything else depends on it and it's the piece T-11 cares about most, then
build outward: starfield → bodies/sprites → trail → prediction → overlays → index.ts composition.
Will log again before the headless-Chromium screenshot run.

## 2026-08-13T15:46Z — resuming after second interruption (usage-limit kill, not a crash)

Orchestrator confirms everything written before the kill was salvaged/committed: all of
`transform.ts`, `starfield.ts`, `sprites.ts`, `bodies.ts`, `trail.ts`, `prediction.ts`,
`overlays.ts`, `index.ts`, the 8 rocket PNGs under `assets/`, and
`__tests__/fakeCanvas.ts` + `__tests__/fixtures.ts` are present on disk exactly as I left them —
verified with a fresh `find` just now, nothing missing. **No code lost, just my in-context plan
for what test files come next.** Also: `packages/web` is now real (T-14 landed it in between my
first and second pause) — `npm run dev/build/typecheck/size` etc. all work now, confirmed
`node_modules/@swingby/core` symlink resolves and `packages/web/package.json` +
`vite.config.ts` + `index.html` + `src/main.ts` exist and are NOT mine to touch.

**Implementation status (all files, one pass, not yet compiled or test-run):**
- `transform.ts` — pure worldToScreenXY/screenToWorldXY/worldToScreenInto, MIN_ZOOM clamp. Done.
- `starfield.ts` — mulberry32-seeded, normalized [0,1] star positions scaled to viewport at draw
  time (not regenerated on resize), wrapf-wrapped parallax. Done.
- `sprites.ts` — 8 literal `new URL('./assets/rocketN[_boost].png', import.meta.url)` calls (NOT
  a templated loop — Vite's static asset analysis needs literal strings per call), lazy `Image()`
  construction guarded by `typeof Image !== "undefined"` so importing this module is safe under
  plain-Node vitest. Done.
- `bodies.ts` — drawSun/drawPlanet/drawPlayer. Planets are procedural (radial gradient + rotating
  equator band), no earth.png — decision #1 in the first log entry. Ship falls back to a drawn
  triangle silhouette when `sprites.get()` returns null (still-loading or no-DOM test env). Done.
- `trail.ts` — Float64Array scratch buffer owned by the `TrailDrawer` closure (grows, never
  reallocated per frame at steady length), bbox cull before touching canvas, 24 alpha-fade
  buckets (overlapping by one point) instead of Godot's flat single-color polyline — decision #4.
  Done.
- `prediction.ts` — one `beginPath`+many `moveTo`/`arc`+one `fill()` per group (player, planets),
  deliberately NOT using the real `Path2D` class since it doesn't exist in the plain-Node test
  env either. Done.
- `overlays.ts` — goal ring / force vector / bounds warning / reset flash. Goal ring and bounds
  warning take an explicit `clockSeconds` param rather than reading a clock internally, so the
  functions themselves stay pure/testable; `index.ts` is the only place that calls
  `performance.now()`. Done.
- `index.ts` — `createRenderer`, `Camera`, `RenderFrame`, `Renderer` typed exactly per
  INTERFACES.md. Draw order mirrors `_draw()` in GameWorld.gd:467-482 (background → prediction →
  trail → goal ring → bodies → force vector → bounds warning → reset flash); Godot's particle step
  and editor-overlay step are both intentionally absent (no particle field in the frozen
  `RenderFrame`; `editorOverlay` is opaque per rule #10, genuinely never read anywhere in this
  file). Body loop, goal-ring screen pos, and force-vector origin all inline the
  halfW+(x-camX)*zoom arithmetic directly rather than calling the allocating `worldToScreenXY`
  helper, specifically to keep the steady-state per-body loop allocation-light — only the public
  `worldToScreen`/`screenToWorld` methods (T-11's hit-testing, called rarely, not per-frame-per-
  point) allocate a fresh `Vec2`. `resize()` sets canvas.width/height from `cssWidth*dpr` and
  calls `ctx.setTransform(dpr,...)` once — dpr never touched again in `draw()`.
- `__tests__/fakeCanvas.ts` — hand-written `FakeContext` class (not a Proxy) implementing every
  ctx method actually used across all draw modules (arc, moveTo, lineTo, fill, stroke, fillRect,
  strokeRect, save/restore/translate/rotate/scale, setTransform, drawImage,
  createRadialGradient→FakeGradient with addColorStop), each call pushed to `calls: Call[]` in
  order. `createFakeCanvas()` returns a `{canvas, ctx}` pair, canvas is a plain object cast
  `as unknown as HTMLCanvasElement`. Chose hand-written over Proxy-autorecording specifically
  because `createRadialGradient`'s return value needs a working `addColorStop` method — a bare
  auto-mock Proxy would return `undefined` there and crash `bodies.ts`'s planet gradient code.
- `__tests__/fixtures.ts` — `makeBody()` (fills every `Body` field, no optionals) and
  `makeFixtureWorld()`: sun (visible) + sun (invisible, gravity 8000, at 400,300) + 2 planets (one
  anchored) + player, `playerIndex:4`, `goalIndex:2`. The invisible sun is baked into the default
  fixture on purpose so any test using it automatically exercises the "hidden sun must not draw"
  path without extra setup.

**Not yet done — this is the actual resume point:**
1. No test files written yet beyond the two helpers above (`fakeCanvas.ts`, `fixtures.ts` are
   support code, not `*.test.ts`). Plan (unchanged from before the kill): `transform.test.ts`
   (round-trip sweep, report max abs error — this is the number the brief demands), then
   `starfield.test.ts`, `trail.test.ts`, `prediction.test.ts`, `bodies.test.ts`,
   `overlays.test.ts`, `index.test.ts` (full-pipeline: draw order, invisible-sun-really-absent via
   arc-count diff of exactly 3 between visible/invisible toggling, editorOverlay is never read,
   resize() sets backing-store size correctly for a given dpr).
2. Have NOT run `npx tsc --noEmit` / `npm run typecheck` on any of this yet — first compile check
   is still pending. Given `bodies.ts` was written before `packages/web` had a real tsconfig
   wired up (T-14 landed mid-task), there's real risk of a subpath-import or lib-config mismatch
   surfacing on first typecheck; expect to spend a cycle on that.
3. Have NOT run vitest at all yet.
4. Have NOT written `dev.html` harness, the screenshot script, the size/perf measurement scripts,
   or `results/T-04-AURORA.md`.
5. Numbers owed and not yet measured, per the coordinator's explicit reminder: round-trip max
   error, gzipped KB of this module, ms/frame, and a real PNG screenshot via headless Chromium
   (global playwright install at `/opt/node22/lib/node_modules/playwright`, Chromium at
   `/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` — already confirmed
   present before the first pause, not yet actually invoked). Also owe: break the camera
   transform on purpose, capture a red test run, then restore and capture green.

**Immediate next action:** write `transform.test.ts` and get a first `npx vitest run` (or
`npm run test -w @swingby/web`, now that it's a real script) executing, even if red, to find
wiring problems early — then proceed test file by test file, then tsc, then the harness/scripts.

## 2026-08-13T15:51Z — unit tests + typecheck green, all 37 tests, before harness/screenshot work

All 7 test files written (`transform`, `starfield`, `trail`, `prediction`, `bodies`, `overlays`,
`index`) — **37/37 passing**, `npx vitest run packages/web/src/render`. Round-trip numbers already
measured from `transform.test.ts`'s own console output (this is the number for the results file):
`worldToScreen->screenToWorld` max abs error **9.313e-10** over 1152 samples (zoom swept
0.0001-100, camera positions incl. world-span corners, viewport sizes incl. 1x1 and mobile
portrait); `screenToWorld->worldToScreen` max abs error **2.001e-11**. Both comfortably under the
1e-9 spec. Note the first number is close-ish to the 1e-9 ceiling — it's dominated by the most
extreme sample (`x:999999,y:-999999` world point at high zoom), not by anything near realistic
game-world magnitudes (0-2600 x 0-1800); realistic-range samples are far tighter. Left the extreme
sample in deliberately since it's still comfortably under spec and is a genuine stress case.

**Two real bugs caught and fixed during first test/typecheck pass** (worth recording, not just
"tests passed eventually"):
1. `index.test.ts`'s dpr-scale-isolation test originally asserted `draw()` calls neither
   `setTransform` NOR `scale`. Wrong: `ctx.scale()` legitimately fires inside `save()/restore()`
   blocks in `bodies.ts` for per-body sprite scaling (unrelated to dpr). Fixed the test to only
   assert `setTransform` is absent from `draw()` — that's the actual "dpr belongs to resize()
   only" claim; `scale` is fine and expected there.
2. The `editorOverlay` opaque-passthrough test compared two full draw() call-log arrays for deep
   equality across two separate `createRenderer()` instances — but `overlays.ts`'s goal-ring pulse
   reads `performance.now()` (see the wall-clock design note in that file), so two draws at
   genuinely different real timestamps produce a (tiny but nonzero) numeric divergence in the
   goal-ring arc radius, unrelated to editorOverlay at all. This is a **real flakiness hazard** in
   any test that deep-compares raw draw output without pinning the clock — fixed by
   `vi.spyOn(performance, "now").mockReturnValue(12345)` around both draws. Flagging this pattern
   explicitly: **any future render test that does exact call-log comparison across two `draw()`
   invocations MUST pin `performance.now()` first**, or it will be intermittently flaky from the
   goal-ring/bounds-warning pulse alone.

**tsc finding, not a logic bug but worth recording so it isn't re-debugged:** `createRenderer`
originally declared `resize`/`draw` as nested `function` DECLARATIONS closing over
`const ctx = canvas.getContext("2d")` (narrowed non-null by an early `if (!ctx) throw`). TS 5.9.3
does **not** propagate that narrowing into nested function *declarations* (hoisting makes them
conservative), producing ~10 "possibly null" errors at every `ctx.*` call site inside
`resize`/`draw`. Converting both to `const resize = (...) => {...}` / `const draw = (...) => {...}`
arrow-function expressions fixed all of them with no other change — TS retains const-narrowing
through arrow/function-expression closures but not through function declarations. **If a future
edit reintroduces a `function foo() {}` declaration inside `createRenderer` that reads `ctx`,
expect this exact error class again** — use an arrow function assigned to a `const` instead.

Full-repo `npx tsc --noEmit -p tsconfig.json` is clean (0 errors) at this point in time — that
includes whatever other tasks have landed so far, not just mine; not a guarantee it stays clean
as other tasks continue landing, but confirms nothing of mine is currently broken or breaking
anyone else.

### Still outstanding (unchanged from previous entry, now narrower)

`dev.html` harness, screenshot(s) via headless Chromium, gzipped-KB measurement of this module,
ms/frame measurement, the "break the transform, show red, restore, show green" proof, and
`results/T-04-AURORA.md`. Doing the perf/screenshot work next since it's the slower/riskier
remaining piece; will log again immediately before invoking headless Chromium.

## 2026-08-13T15:54Z — bundle size measured, harness built, about to launch headless Chromium

**Bundle size (esbuild --bundle --minify, entry = render/index.ts only, browser platform):**
raw 8023 bytes (7.83 KB), gzip -9 = **3228 bytes = 3.15 KB**. Confirmed by grepping the output
that the 8 `new URL('./assets/rocketN[_boost].png', import.meta.url)` calls pass through as plain
string-literal expressions — esbuild does not need an asset loader configured for that pattern, it
just leaves it as ordinary JS, exactly as the plain-ESM design in sprites.ts's doc comment assumed.
This 3.15 KB is code weight only; confirmed by actually reading T-14's already-landed
`infra/size-check.mjs` that the 250 KB gzip budget it enforces is scoped to `.js/.mjs/.css/.html`
in the build output and explicitly excludes static binary assets like the rocket PNGs (its own
comment names them) — so the ~209 KB of PNGs is not part of that gate at all, only this 3.15 KB is.

**Built the dev harness:**
- `dev-scenes.ts` — 3 hand-rolled `World` fixtures (Twin System; Hidden Pull, with one visible +
  one invisible sun; Dense System, 2 suns/3 planets/boosting player) via a local `body()` builder,
  no import of level.ts/levels.json/physics.ts anywhere.
- `dev.ts` — a small toy inverse-square-ish integrator (explicitly NOT physics.ts, doc-commented
  as such twice so nobody mistakes it for the real thing) driving `createRenderer` via rAF, plus a
  `window.__aurora` control surface (`selectScene`, `step(n)` for synchronous deterministic
  ticking, `fillTrail()` to force a full 5000-point trail instantly instead of waiting ~83s of
  real ticks, `benchmark(n)` timing `renderer.draw()` in a real browser against a real canvas
  context, `setTheme`) so a Playwright script can drive it deterministically instead of racing rAF
  timing for the screenshot/perf numbers.
- `dev.html` — canvas + a control bar with scene switch/trail/prediction toggles, a flash trigger,
  a bounds-warning slider, and a page-chrome light/dark toggle. **Decision, flagged for the results
  file:** the renderer's own canvas output has no light/dark concept — `COLORS` in constants.ts is
  a single frozen space palette, there is no theme field anywhere in `RenderFrame`/`Camera`. Task
  doc deliverable #5 ("Screenshots of 3 levels, light and dark") is interpreted as the dev-harness
  PAGE CHROME's light/dark, not the rendered game content, which is documented inline in dev.html's
  own header comment and will be repeated in results/T-04-AURORA.md so it doesn't read as a missed
  requirement.

`npx tsc --noEmit -p tsconfig.json` still clean after adding dev.ts/dev-scenes.ts/dev.html.

**Vite dev server is now running in the background** (`npm run dev -w @swingby/web -- --port 5199
--strictPort`, log at `/tmp/.../scratchpad/vite-dev.log`, confirmed "VITE v5.4.21 ready" + listening
on http://localhost:5199/) specifically on a non-default port to avoid colliding with any other
concurrent agent that might have port 5173 open. **About to drive it with headless Chromium via
Playwright** (global install at /opt/node22/lib/node_modules/playwright, browser at
/opt/pw-browsers/chromium) for: (a) screenshots of the 3 scenes, (b) the light/dark chrome shots,
(c) the in-browser `benchmark()` ms/frame numbers. This is the "before anything slow/risky" log
point the coordinator asked for. If interrupted after this point, the dev server may still be
running in the background — check `/tmp/.../scratchpad/vite-dev.log` and `ps aux | grep vite`
before starting a second one on the same port.

## 2026-08-13T16:21Z — perf investigation: found and fixed a real, reproducible slow path in trail drawing

**Bundle size, measured cleanly before any of the perf chase below:** `npx esbuild --bundle
--minify --format=esm render/index.ts` -> raw 8023 B, gzip -9 = **3228 B = 3.15 KB**. Verified the
8 `new URL(...)` rocket asset references pass through the bundle as plain string literals (grepped
for `rocket1.png` etc in the output) — confirms sprites.ts's plain-ESM design needs no
bundler-specific asset loader. This number is stable/final, not touched by anything below.

**The perf story (read this before touching `FADE_BUCKETS` or `MIN_SEGMENT_PX` in trail.ts):**

First naive benchmark (in-browser, `window.__aurora.benchmark()`, Dense System scene, 1920x1080,
full 5000-point trail via `fillTrail()` — a coarse widely-spaced synthetic spiral, NOT
representative of real gameplay) gave ~14.8ms/frame with `showTrail`+`showPrediction` both on.
Over budget. Isolated the cost with `showTrail`/`showPrediction` toggled independently: trail
alone was ~13ms of that, prediction ~0.4ms, "neither" (starfield+bodies+overlays) ~3.3ms — trail
dominates by far.

Two real fixes, in order:
1. **Realized my synthetic benchmark trail was itself unrealistic.** Real gameplay records one
   trail point per PHYSICS TICK (144 Hz — `TPS` in constants.ts), so consecutive points are
   usually far less than 1 screen px apart at normal ship speed/zoom — nothing like my
   deliberately-spread-out spiral fixture. Added `MIN_SEGMENT_PX` (1.2px) decimation to trail.ts:
   collapse runs of points closer together on screen than that (always keeping the current head),
   built once per `draw()` into the same preallocated scratch buffer, no extra allocation. Added
   `dev.ts`'s `fillDenseTrail()` (sub-pixel-at-zoom~0.6 synthetic trail, meant to mirror real
   144Hz sampling) alongside the original `fillTrail()` (kept as the pathological/worst-case
   fixture, since decimation legitimately can't help a trail that's ALREADY spread out — e.g. a
   fast continuous boost burn covering real distance). Also switched `lineJoin`/`lineCap` from
   "round"/"round" to "bevel"/"butt" — round joins rasterize a filled arc at every vertex, wasted
   cost at 1-2px line width.
2. **Also batched the starfield** (`starfield.ts`): was ~190 individual `beginPath+arc+fill` calls
   for stars plus 6 overlapping large-radius glow circles. Regrouped stars into a small fixed
   palette of `SHADES_PER_LAYER=4` colour buckets per layer, computed ONCE at `buildStarfield()`
   time (not per frame) — `drawStarfield` now does one `beginPath`+many `arc`+one `fill()` per
   bucket (~12 fill calls total for ~192 stars) instead of ~192. Replaced the 6 flat overlapping
   glow circles (3 nested radii x 2 positions, all overpainting the same area redundantly) with 2
   single `createRadialGradient`-filled circles — same soft-falloff look, way less redundant
   pixel fill. This dropped the "neither" (no trail/prediction) floor from ~3.3ms to ~0.15-0.2ms.

**Then found something I did NOT expect and want the next reader to know about explicitly:** after
both fixes, re-benchmarking the (now-decimated) "dense"/realistic trail scenario was **bimodal**
across separate browser launches of the *identical* code/scenario — sometimes ~0.3-0.6ms (fast),
sometimes ~9-15ms (slow), unpredictably, and **sticky for the rest of that page's lifetime** once
in one mode (a 3000-iteration warmup inside a "slow" page never dropped it into the fast regime;
a fresh page/new browser launch could roll either way). Ruled out: (a) V8 JIT warmup — a "slow"
page stayed slow for 3000+ iterations, a "fast" page was fast from iteration 1; (b) CPU contention
from other agents — this is a single-tenant isolated container (`ps aux` showed only this
session's own processes; `/proc/loadavg` ~0.6-1.0 on 4 cores throughout). The "floor" scenario
(starfield+bodies+overlays, no trail) stayed fast and stable in EVERY trial regardless of what
happened to the trail scenario in the same run — narrowing the nondeterminism specifically to the
multi-`stroke()`-call trail path, not general canvas slowness.

**Fix, empirically found and then verified, not guessed:** dropped `FADE_BUCKETS` from 24 to 8
(fewer separate `stroke()` calls per frame for the fade). Re-ran 19 independent fresh-browser
trials after that change (8x dense+prediction, 8x coarse+prediction, 3x floor) — **zero
recurrences of the slow mode**. Stable results: dense (realistic) trail + prediction median
**0.448 ms** (range 0.404-0.477ms, n=8); coarse (pathological worst-case, no decimation benefit)
trail + prediction median **0.683 ms** (range 0.650-0.705ms, n=8); floor median **0.157ms**
(range 0.155-0.163ms, n=3). All comfortably under the 4ms/frame budget with a wide margin. I
cannot fully explain WHY 24 vs 8 stroke() calls flips a Chromium-internal fast/slow path (some
internal batching/promotion threshold is my best guess, not confirmed) — recording this as a
found-and-fixed empirical result, not a theory to trust blindly. **If trail perf work resumes
later and someone raises FADE_BUCKETS again, re-run a multi-trial (8+) fresh-browser check before
trusting a single sample — a single good number after this investigation is not enough evidence.**

Scripts used for all of the above are NOT part of the deliverable (scratchpad only, not committed
by design — they live under `/tmp/.../scratchpad/`, gone once this container recycles); the
*numbers* above are what's load-bearing and go in `results/T-04-AURORA.md`, along with a note that
this measurement methodology (headless Chromium via Playwright, `performance.now()` around a tight
`renderer.draw()` loop) is a substitute for the task doc's suggested DevTools Performance-panel
manual capture, which isn't scriptable in this environment.

**Next step:** re-run the full render test suite + tsc (starfield.ts's public shape changed —
`Star`/`StarLayer` no longer carry per-star r/g/b/a, `starfield.test.ts` needed updating for that,
already done), redo the screenshot capture (scene visuals should be unaffected — 8 fade buckets is
still a visible gradient, just coarser), then the "break the transform, show red, restore" proof,
then write results/T-04-AURORA.md.
