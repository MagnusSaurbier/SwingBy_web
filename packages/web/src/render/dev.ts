/**
 * Dev harness for the renderer. Drives `createRenderer` against hand-rolled fixture scenes
 * (dev-scenes.ts), not real levels or `physics.ts`.
 *
 * The "simulation" below is a small toy integrator that exists ONLY to make the harness move and
 * exercise every draw path (trail growth, prediction, boost sprite swap, force vector, bounds
 * warning, reset flash). It is deliberately not physically accurate and must never be mistaken
 * for `packages/core/src/physics.ts` — it does not even use the real gravity constants file.
 *
 * `window.__aurora` is a small imperative control surface so a Playwright script can drive this
 * page deterministically (scene selection, ticking N steps synchronously, benchmarking draw())
 * without depending on real-time rAF timing — see the screenshot/perf scripts under
 * notes/archive/T-04-AURORA/ (referenced from notes/archive/T-04-AURORA/results.md).
 */

import {
  TRAIL_LENGTH,
  PREDICTION_TICKS,
  PREDICTION_STRIDE,
} from "@swingby/core/constants";
import type { Prediction, Vec2, World } from "@swingby/core/types";
import { createRenderer, type Camera, type RenderFrame } from "./index";
import { allScenes, type Scene } from "./dev-scenes";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) throw new Error("dev.ts: #stage canvas missing");
const renderer = createRenderer(canvas);

const scenes = allScenes();
let sceneIndex = 0;
let world: World = cloneWorld(scenes[0]!.world);
let trail: Vec2[] = [];
let showTrail = true;
let showPrediction = true;
let boundsWarning = 0;
let flash = 0;
let camera: Camera = {
  x: world.bodies[world.playerIndex]!.x,
  y: world.bodies[world.playerIndex]!.y,
  zoom: 0.6,
};
let running = true;

function cloneWorld(w: World): World {
  return { ...w, bodies: w.bodies.map((b) => ({ ...b })) };
}

/** Toy attraction — NOT the real physics model. See file header. */
function toyStep(w: World, dt: number): void {
  const suns = w.bodies.filter((b) => b.type === "sun" && b.gravity !== 0);
  for (let i = 0; i < w.bodies.length; i++) {
    const b = w.bodies[i]!;
    if (b.type === "sun" || b.anchored) continue;
    let ax = 0;
    let ay = 0;
    for (const s of suns) {
      const dx = s.x - b.x;
      const dy = s.y - b.y;
      const distSq = Math.max(400, dx * dx + dy * dy);
      const dist = Math.sqrt(distSq);
      const pull = s.gravity / distSq;
      ax += (dx / dist) * pull;
      ay += (dy / dist) * pull;
    }
    b.xAcc = ax;
    b.yAcc = ay;
    b.xVel += ax * dt;
    b.yVel += ay * dt;
    b.x += b.xVel * dt;
    b.y += b.yVel * dt;
    if (b.type === "planet") {
      b.angle += 0.4 * dt;
    } else if (b.type === "player" && (b.xVel !== 0 || b.yVel !== 0)) {
      b.angle = Math.atan2(b.yVel, b.xVel) + Math.PI / 2;
    }
  }
}

function buildPrediction(w: World, ticks: number, dt: number): Prediction {
  const shadow = cloneWorld(w);
  const player: Vec2[] = [];
  const planetIndices = shadow.bodies
    .map((b, i) => (b.type === "planet" && !b.anchored ? i : -1))
    .filter((i) => i >= 0);
  const planets: Vec2[][] = planetIndices.map(() => []);
  for (let t = 0; t < ticks; t++) {
    toyStep(shadow, dt);
    if (t % PREDICTION_STRIDE === 0) {
      const p = shadow.bodies[shadow.playerIndex];
      if (p) player.push({ x: p.x, y: p.y });
      planetIndices.forEach((bodyIdx, k) => {
        const b = shadow.bodies[bodyIdx];
        if (b) planets[k]!.push({ x: b.x, y: b.y });
      });
    }
  }
  return { player, planets };
}

function currentFrame(): RenderFrame {
  const player = world.bodies[world.playerIndex];
  const forceVector: Vec2 | null = player
    ? { x: player.xAcc, y: player.yAcc }
    : null;
  const prediction = showPrediction
    ? buildPrediction(world, Math.min(PREDICTION_TICKS, 600), 1 / 60)
    : null;
  return {
    world,
    camera,
    trail,
    prediction,
    forceVector,
    boundsWarning,
    flash,
    showTrail,
  };
}

function tick(): void {
  toyStep(world, 1 / 60);
  const player = world.bodies[world.playerIndex];
  if (player) {
    trail.push({ x: player.x, y: player.y });
    if (trail.length > TRAIL_LENGTH)
      trail.splice(0, trail.length - TRAIL_LENGTH);
    camera = { x: player.x, y: player.y, zoom: camera.zoom };
  }
  if (flash > 0) flash = Math.max(0, flash - 0.02);
}

function render(): void {
  renderer.draw(currentFrame());
}

function selectScene(index: number): void {
  sceneIndex = ((index % scenes.length) + scenes.length) % scenes.length;
  const scene: Scene = scenes[sceneIndex]!;
  world = cloneWorld(scene.world);
  trail = [];
  const player = world.bodies[world.playerIndex];
  camera = { x: player?.x ?? 0, y: player?.y ?? 0, zoom: 0.6 };
  const label = document.querySelector<HTMLElement>("#scene-label");
  if (label) label.textContent = scene.name;
}

function resizeToWindow(): void {
  const dpr = window.devicePixelRatio || 1;
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}

window.addEventListener("resize", resizeToWindow);
resizeToWindow();
selectScene(0);

function loop(): void {
  if (running) {
    tick();
    render();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- UI wiring -------------------------------------------------------------

document
  .querySelector<HTMLButtonElement>("#next-scene")
  ?.addEventListener("click", () => selectScene(sceneIndex + 1));
document
  .querySelector<HTMLButtonElement>("#prev-scene")
  ?.addEventListener("click", () => selectScene(sceneIndex - 1));
document
  .querySelector<HTMLInputElement>("#toggle-trail")
  ?.addEventListener("change", (e) => {
    showTrail = (e.target as HTMLInputElement).checked;
  });
document
  .querySelector<HTMLInputElement>("#toggle-prediction")
  ?.addEventListener("change", (e) => {
    showPrediction = (e.target as HTMLInputElement).checked;
  });
document
  .querySelector<HTMLButtonElement>("#trigger-flash")
  ?.addEventListener("click", () => {
    flash = 1;
  });
document
  .querySelector<HTMLInputElement>("#bounds-warning-slider")
  ?.addEventListener("input", (e) => {
    boundsWarning = Number((e.target as HTMLInputElement).value) / 100;
  });
document
  .querySelector<HTMLButtonElement>("#toggle-theme")
  ?.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
  });

// --- Scripted / headless control surface for the screenshot + perf scripts -------------------

interface AuroraHarness {
  sceneNames: string[];
  selectScene(i: number): void;
  setShowTrail(v: boolean): void;
  setShowPrediction(v: boolean): void;
  setBoundsWarning(v: number): void;
  setFlash(v: number): void;
  setTheme(theme: "light" | "dark"): void;
  pause(): void;
  resume(): void;
  /** Advances the toy simulation `n` ticks synchronously (no rAF), then renders once. */
  step(n: number): void;
  /** Fills the trail to TRAIL_LENGTH with a coarse, widely-spread spiral (worst case for decimation). */
  fillTrail(): void;
  /**
   * Fills the trail to TRAIL_LENGTH with sub-pixel-at-typical-zoom spacing, mirroring a real
   * 144Hz-sampled gameplay trail (ship moving slowly relative to tick rate) — see trail.ts's
   * `MIN_SEGMENT_PX` decimation.
   */
  fillDenseTrail(): void;
  /** Times `renderer.draw()` against the CURRENT frame contents, `n` times. */
  benchmark(n: number): { totalMs: number; meanMs: number; n: number };
  renderOnce(): void;
}

const harness: AuroraHarness = {
  get sceneNames() {
    return scenes.map((s) => s.name);
  },
  selectScene,
  setShowTrail(v) {
    showTrail = v;
  },
  setShowPrediction(v) {
    showPrediction = v;
  },
  setBoundsWarning(v) {
    boundsWarning = v;
  },
  setFlash(v) {
    flash = v;
  },
  setTheme(theme) {
    document.documentElement.classList.toggle("light", theme === "light");
  },
  pause() {
    running = false;
  },
  resume() {
    running = true;
  },
  step(n) {
    for (let i = 0; i < n; i++) tick();
    render();
  },
  fillTrail() {
    const player = world.bodies[world.playerIndex];
    if (!player) return;
    trail = new Array(TRAIL_LENGTH);
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const t = i * 0.05;
      trail[i] = {
        x: player.x + Math.sin(t) * 300,
        y: player.y + Math.cos(t * 0.7) * 220,
      };
    }
    render();
  },
  fillDenseTrail() {
    const player = world.bodies[world.playerIndex];
    if (!player) return;
    trail = new Array(TRAIL_LENGTH);
    // ~0.01 world units/tick of drift -> sub-pixel at typical zoom, same order of magnitude as a
    // slow real orbit sampled every physics tick (144Hz).
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const t = i * 0.003;
      trail[i] = {
        x: player.x + Math.sin(t) * 12 + i * 0.01,
        y: player.y + Math.cos(t) * 9,
      };
    }
    render();
  },
  benchmark(n) {
    const frame = currentFrame();
    const start = performance.now();
    for (let i = 0; i < n; i++) renderer.draw(frame);
    const totalMs = performance.now() - start;
    return { totalMs, meanMs: totalMs / n, n };
  },
  renderOnce() {
    render();
  },
};

(window as unknown as { __aurora: AuroraHarness }).__aurora = harness;
