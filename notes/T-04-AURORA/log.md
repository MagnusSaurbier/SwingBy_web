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
