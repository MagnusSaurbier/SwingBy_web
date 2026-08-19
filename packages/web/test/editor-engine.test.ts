/**
 * T-11 DRAFT — headless tests for the editor engine (`createEditorEngine` in `editor/editor.ts`):
 * hit-testing accuracy across the editor's full zoom range, placement, dragging (move/velocity/
 * resize+gravity coupling), undo, the save/validate gate (5/5 invalid cases refused), and the
 * round-trip guarantee through T-03's real `serialize`/`hydrate`.
 *
 * Uses the REAL `createRenderer` (T-04) against a fake canvas (see `editor/__tests__/fakes.ts`) so
 * every `worldToScreen`/`screenToWorld` call in these tests is the actual transform, never a
 * reimplementation — exactly what the task doc requires ("Hit-testing uses T-04's worldToScreen/
 * screenToWorld... rely on that as exact inverses").
 */
import { describe, expect, it } from "vitest";
import type { Body, BodyType, Level } from "@swingby/core";
import { hydrate, serialize, validate } from "@swingby/core";
import { createRenderer, type Renderer } from "../src/render/index.js";
import { makeFakeCanvas } from "../src/editor/__tests__/fakes.js";
import { createEditorEngine, type EditorEngine } from "../src/editor/editor.js";
import { MAX_ZOOM, MIN_ZOOM } from "../src/editor/viewport.js";

const VIEWPORT = { width: 960, height: 600 };

function makeEngine(): { engine: EditorEngine; renderer: Renderer } {
  const { canvas } = makeFakeCanvas(VIEWPORT.width, VIEWPORT.height);
  const renderer = createRenderer(canvas);
  renderer.resize(VIEWPORT.width, VIEWPORT.height, 1);
  const engine = createEditorEngine({ renderer, viewport: VIEWPORT });
  return { engine, renderer };
}

/** Places a body of `type` at the exact world coordinates `(wx, wy)` via the real placement
 *  gesture (armPlace + pointerDown + pointerUp at the screen point that maps back to that world
 *  point under the engine's current camera) — exercising the real code path, not a shortcut. */
function placeAt(
  engine: EditorEngine,
  renderer: Renderer,
  type: BodyType,
  wx: number,
  wy: number,
): void {
  engine.armPlace(type);
  const screenPt = renderer.worldToScreen({ x: wx, y: wy }, engine.getCamera());
  engine.pointerDown(screenPt);
  engine.pointerUp(screenPt);
}

// ---------------------------------------------------------------------------
// Hit-testing across the editor's full supported zoom range [MIN_ZOOM, MAX_ZOOM]
// ---------------------------------------------------------------------------

describe("hit-testing accuracy across zoom extremes", () => {
  const zoomLevels = [MIN_ZOOM, 0.25, 0.5, 1, 2, 3, MAX_ZOOM];

  for (const zoom of zoomLevels) {
    it(`selects the correct body at zoom=${zoom}`, () => {
      const { engine, renderer } = makeEngine();
      // Force the camera to this exact zoom, centered at a fixed origin, so screen positions are
      // predictable regardless of fitCamera's own auto-fit logic.
      const camera = engine.getCamera();
      camera.x = 1300;
      camera.y = 900;
      camera.zoom = zoom;

      placeAt(engine, renderer, "player", 1300, 900);
      placeAt(engine, renderer, "sun", 1900, 900); // far enough apart at every tested zoom
      placeAt(engine, renderer, "planet", 1300, 1500);

      const bodies = engine.getBodies();
      expect(bodies).toHaveLength(3);

      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        const screenPt = renderer.worldToScreen(
          { x: b.x, y: b.y },
          engine.getCamera(),
        );
        expect(engine.hitTest(screenPt)).toBe(i);
      }

      // A point far from everything hits nothing.
      expect(engine.hitTest({ x: -99999, y: -99999 })).toBe(-1);
    });
  }

  it("z-order: overlapping bodies resolve to the topmost (last-placed) one", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 1000, 1000);
    placeAt(engine, renderer, "planet", 1000, 1000); // exactly on top of the first
    const screenPt = renderer.worldToScreen(
      { x: 1000, y: 1000 },
      engine.getCamera(),
    );
    expect(engine.hitTest(screenPt)).toBe(1); // the second (topmost) one wins
  });
});

// ---------------------------------------------------------------------------
// Placement, selection, dragging
// ---------------------------------------------------------------------------

describe("placement", () => {
  it("click-to-place and press-and-drag both commit at the release point", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("planet");
    const downPt = renderer.worldToScreen(
      { x: 500, y: 500 },
      engine.getCamera(),
    );
    const upPt = renderer.worldToScreen({ x: 700, y: 550 }, engine.getCamera());
    engine.pointerDown(downPt); // ghost appears at (500,500)
    engine.pointerMove(upPt); // dragged to (700,550)
    engine.pointerUp(upPt); // commits at the release point, not the down point
    expect(engine.getBodies()).toHaveLength(1);
    expect(engine.getBodies()[0]!.x).toBeCloseTo(700, 6);
    expect(engine.getBodies()[0]!.y).toBeCloseTo(550, 6);
  });

  it("Escape cancels an armed placement without creating a body", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("sun");
    const pt = renderer.worldToScreen({ x: 100, y: 100 }, engine.getCamera());
    engine.pointerDown(pt);
    engine.cancelPlace();
    engine.pointerUp(pt);
    expect(engine.getBodies()).toHaveLength(0);
  });

  it("newly placed sun defaults to gravity 1000 / size 18 / visible; planet/player default to gravity 0 / size 10", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 0, 0);
    placeAt(engine, renderer, "planet", 100, 0);
    placeAt(engine, renderer, "player", 200, 0);
    const [sun, planet, player] = engine.getBodies();
    expect(sun).toMatchObject({ gravity: 1000, size: 18, visible: true });
    expect(planet).toMatchObject({ gravity: 0, size: 10, anchored: false });
    expect(player).toMatchObject({ gravity: 0, size: 10 });
  });
});

describe("dragging a selected body's on-canvas handles", () => {
  it("move handle: clicking the body directly and dragging moves it", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 500, 500);
    const camera = engine.getCamera();
    const startScreen = renderer.worldToScreen({ x: 500, y: 500 }, camera);
    engine.pointerDown(startScreen); // selects + begins a move drag
    const targetScreen = renderer.worldToScreen({ x: 800, y: 650 }, camera);
    engine.pointerMove(targetScreen);
    engine.pointerUp(targetScreen);
    const body = engine.getBodies()[0]!;
    expect(body.x).toBeCloseTo(800, 6);
    expect(body.y).toBeCloseTo(650, 6);
  });

  it("velocity handle sets xVel/yVel = delta*0.01, matching LevelEditor.gd's handle_drag formula", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 500, 500);
    engine.select(0);
    const camera = engine.getCamera();
    // The velocity button sits at a fixed offset when velocity is 0,0 — find it via the overlay.
    const overlay = engine.getOverlay();
    const velBtn = overlay.buttons.find((b) => b.name === "velocity")!;
    engine.pointerDown(velBtn);
    const dragTo = renderer.worldToScreen(
      { x: 500 + 300, y: 500 - 200 },
      camera,
    ); // world delta (300,-200)
    engine.pointerMove(dragTo);
    engine.pointerUp(dragTo);
    const body = engine.getBodies()[0]!;
    expect(body.xVel).toBeCloseTo(3, 6); // 300 * 0.01
    expect(body.yVel).toBeCloseTo(-2, 6); // -200 * 0.01
  });

  it("sun has no velocity handle and its velocity never changes", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 500, 500);
    engine.select(0);
    const overlay = engine.getOverlay();
    expect(overlay.buttons.some((b) => b.name === "velocity")).toBe(false);
  });

  it("resize handle scales size and, for non-player bodies, gravity via the cubic coupling", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 500, 500);
    engine.select(0);
    const camera = engine.getCamera();
    const overlay = engine.getOverlay();
    const resizeBtn = overlay.buttons.find((b) => b.name === "resize")!;
    engine.pointerDown(resizeBtn);
    // First move establishes the grab distance (LevelEditor.gd:431-433's own mechanic — the drag
    // is relative to where the handle was grabbed, not an absolute radius); the second move drags
    // further out to actually grow the resize radius.
    engine.pointerMove(resizeBtn);
    const far = renderer.worldToScreen({ x: 500 - 400, y: 500 }, camera);
    engine.pointerMove(far);
    engine.pointerUp(far);
    const body = engine.getBodies()[0]!;
    expect(body.size).toBeGreaterThan(18);
    expect(body.gravity).toBeCloseTo(body.size ** 3 * (1000 / 18 ** 3), 6);
  });

  it("resize does NOT scale gravity for the player (decision #6 — non-player only)", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 500, 500);
    engine.select(0);
    engine.setSelectedGravity(0);
    const camera = engine.getCamera();
    const overlay = engine.getOverlay();
    const resizeBtn = overlay.buttons.find((b) => b.name === "resize")!;
    engine.pointerDown(resizeBtn);
    engine.pointerMove(resizeBtn);
    const far = renderer.worldToScreen({ x: 500 - 400, y: 500 }, camera);
    engine.pointerMove(far);
    engine.pointerUp(far);
    const body = engine.getBodies()[0]!;
    expect(body.size).toBeGreaterThan(10);
    expect(body.gravity).toBe(0); // unaffected, unlike a sun/planet
  });

  it("delete button removes the object and reindexes goal/selection", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    placeAt(engine, renderer, "sun", 100, 0);
    engine.select(1);
    engine.setSelectedAsGoal();
    expect(engine.getGoalIndex()).toBe(1);
    const overlay = engine.getOverlay();
    const delBtn = overlay.buttons.find((b) => b.name === "delete")!;
    engine.pointerDown(delBtn);
    expect(engine.getBodies()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("covers placement: N placements, N undos returns to empty", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 0, 0);
    placeAt(engine, renderer, "planet", 100, 0);
    placeAt(engine, renderer, "planet", 200, 0);
    expect(engine.getBodies()).toHaveLength(3);
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(0);
    expect(engine.undo()).toBe(false); // nothing left to undo
    expect(engine.canUndo()).toBe(false);
  });

  it("covers move, resize, and delete, each restoring exact prior state", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 500, 500);
    engine.undo(); // undo the placement's own snapshot push, back to empty — then re-place to start clean
    placeAt(engine, renderer, "sun", 500, 500);
    const afterPlace = engine.getBodies()[0]!;
    expect(afterPlace.x).toBe(500);

    // move
    engine.select(0);
    const camera = engine.getCamera();
    engine.pointerDown(renderer.worldToScreen({ x: 500, y: 500 }, camera));
    engine.pointerMove(renderer.worldToScreen({ x: 900, y: 900 }, camera));
    engine.pointerUp(renderer.worldToScreen({ x: 900, y: 900 }, camera));
    expect(engine.getBodies()[0]!.x).toBeCloseTo(900, 6);

    // resize
    const overlay = engine.getOverlay();
    const resizeBtn = overlay.buttons.find((b) => b.name === "resize")!;
    engine.pointerDown(resizeBtn);
    engine.pointerMove(resizeBtn);
    engine.pointerMove(
      renderer.worldToScreen({ x: 900 - 400, y: 900 }, camera),
    );
    engine.pointerUp(renderer.worldToScreen({ x: 900 - 400, y: 900 }, camera));
    const sizeAfterResize = engine.getBodies()[0]!.size;
    expect(sizeAfterResize).toBeGreaterThan(18);

    // delete
    engine.deleteAt(0);
    expect(engine.getBodies()).toHaveLength(0);

    // undo delete -> back with the resized body
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(1);
    expect(engine.getBodies()[0]!.size).toBeCloseTo(sizeAfterResize, 6);

    // undo resize -> size 18 again
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()[0]!.size).toBe(18);

    // undo move -> back at (500,500)
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()[0]!.x).toBe(500);
    expect(engine.getBodies()[0]!.y).toBe(500);
  });

  it("caps at 50 entries", () => {
    const { engine, renderer } = makeEngine();
    for (let i = 0; i < 60; i++) placeAt(engine, renderer, "planet", i, 0);
    expect(engine.undoDepth()).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Preview gate (engine-level) — see notes/T-11-DRAFT/log.md decisions #4/#5.
// ---------------------------------------------------------------------------

describe("preview gate", () => {
  it("blocks every mutating operation while active, and restores normal operation once cleared", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    const before = JSON.parse(JSON.stringify(engine.getBodies()));

    engine.setPreviewGate(true);
    expect(engine.requiresReset()).toBe(true);

    engine.select(0); // select() itself is gated too (defensive)
    engine.setSelectedVelocity(5, 5);
    engine.setSelectedGravity(500);
    engine.setSelectedSize(30);
    engine.armPlace("sun");
    engine.pointerDown({ x: 1, y: 1 });
    engine.pointerUp({ x: 1, y: 1 });
    engine.deleteAt(0);
    engine.clear();
    expect(engine.undo()).toBe(false);

    expect(engine.getBodies()).toEqual(before);
    expect(engine.getPlaceType()).toBeNull(); // armPlace was refused too

    engine.setPreviewGate(false);
    expect(engine.requiresReset()).toBe(false);
    engine.select(0);
    engine.setSelectedVelocity(5, 5);
    expect(engine.getBodies()[0]!.xVel).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Save / validate gate — 5/5 invalid cases refused, each reporting ALL applicable errors.
// ---------------------------------------------------------------------------

describe("save is refused for every invalid case (5/5)", () => {
  it("1/5: no player", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 0, 0);
    placeAt(engine, renderer, "planet", 100, 0);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("exactly one player"))).toBe(
        true,
      );
  });

  it("2/5: two players", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    placeAt(engine, renderer, "player", 100, 0);
    placeAt(engine, renderer, "sun", 200, 0);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("found 2"))).toBe(true);
  });

  it("3/5: goal points at the player", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    placeAt(engine, renderer, "sun", 100, 0);
    engine.select(0); // the player
    engine.setSelectedAsGoal();
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.errors.some((e) => e.includes("must not reference the player")),
      ).toBe(true);
  });

  it("4/5: goal.range <= 0", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    placeAt(engine, renderer, "sun", 100, 0);
    engine.select(1);
    engine.setSelectedAsGoal();
    engine.setGoalRange(0);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("goal.range"))).toBe(true);
  });

  it("5/5: no body with gravity > 0", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    placeAt(engine, renderer, "planet", 100, 0); // default gravity 0, no sun placed
    engine.select(1);
    engine.setSelectedAsGoal();
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("gravity > 0"))).toBe(true);
  });

  it("a valid, fully authored level IS accepted", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 0, 0);
    placeAt(engine, renderer, "sun", 400, 0);
    engine.select(1);
    engine.setSelectedAsGoal();
    engine.setGoalRange(80);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(true);
  });

  it("multiple simultaneous errors are ALL reported, not just the first", () => {
    const { engine, renderer } = makeEngine();
    // No player, no gravity source, and (once goal is force-clamped) a degenerate goal.
    placeAt(engine, renderer, "planet", 0, 0);
    engine.select(0);
    engine.setSelectedAsGoal();
    engine.setGoalRange(-5);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("exactly one player"))).toBe(
        true,
      );
      expect(result.errors.some((e) => e.includes("gravity > 0"))).toBe(true);
      expect(result.errors.some((e) => e.includes("goal.range"))).toBe(true);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize(hydrate(engine.toLevel())) deep-equals engine.toLevel(), across several
// authored levels.
// ---------------------------------------------------------------------------

describe("round-trip through T-03's real serialize/hydrate", () => {
  function authoredLevel(
    build: (engine: EditorEngine, renderer: Renderer) => void,
  ): Level {
    const { engine, renderer } = makeEngine();
    build(engine, renderer);
    return engine.toLevel();
  }

  const levels: Level[] = [
    authoredLevel((engine, renderer) => {
      placeAt(engine, renderer, "player", 0, 0);
      placeAt(engine, renderer, "sun", 400, 0);
      engine.select(1);
      engine.setSelectedAsGoal();
    }),
    authoredLevel((engine, renderer) => {
      placeAt(engine, renderer, "player", 100, 100);
      placeAt(engine, renderer, "sun", 500, 100);
      placeAt(engine, renderer, "planet", 700, 300);
      engine.select(1);
      engine.setSelectedVisible(false); // invisible sun
      engine.select(2);
      engine.setSelectedAnchored(true); // anchored planet
      engine.setSelectedVelocity(0.4, -0.1);
      engine.setSelectedAsGoal();
      engine.setGoalRange(120);
      engine.setMeta("Round Trip Two", "Test Author");
    }),
    authoredLevel((engine, renderer) => {
      placeAt(engine, renderer, "player", -200, 50);
      engine.select(0);
      engine.setSelectedVelocity(1.2, 0.3);
      placeAt(engine, renderer, "sun", 300, 50);
      engine.select(1);
      engine.setSelectedGravity(5000);
      engine.setSelectedSize(25);
      engine.setSelectedAsGoal();
      engine.setGoalRange(30);
    }),
    authoredLevel((engine, renderer) => {
      placeAt(engine, renderer, "player", 0, 0);
      placeAt(engine, renderer, "sun", 1000, 0);
      placeAt(engine, renderer, "planet", 500, 500);
      placeAt(engine, renderer, "planet", -500, 500);
      engine.select(3);
      engine.setSelectedAsGoal();
      engine.setGoalRange(200);
      engine.setMeta("", ""); // exercise the "Custom Stage"/"Guest" fallback
    }),
    authoredLevel((engine, renderer) => {
      placeAt(engine, renderer, "player", 10, 10);
      placeAt(engine, renderer, "sun", 2000, 1500);
      engine.select(1);
      engine.setSelectedAsGoal();
      engine.setGoalRange(50); // exactly the default — exercises the omit-if-default serialize branch
    }),
  ];

  it(`round-trips exactly for all ${levels.length} authored levels`, () => {
    let okCount = 0;
    for (const level of levels) {
      const world = hydrate(level);
      const back = serialize(world, { name: level.name, author: level.author });
      expect(back).toEqual(level);
      expect(validate(level).ok).toBe(true);
      okCount++;
    }
    expect(okCount).toBe(levels.length);
  });
});

// ---------------------------------------------------------------------------
// The resize handle follows the cursor for the duration of its own drag (repo-owner request),
// exactly as the velocity handle already did. The handle's RESTING position is unchanged: it still
// sits at the fixed compass offset left of the body whenever no resize drag is in progress.
// ---------------------------------------------------------------------------

describe("resize handle follows the cursor during its own drag", () => {
  function selectedPlanet(): { engine: EditorEngine; renderer: Renderer } {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 1300, 900);
    engine.select(0);
    return { engine, renderer };
  }
  const btn = (engine: EditorEngine, name: string) =>
    engine.getOverlay().buttons.find((b) => b.name === name)!;
  /** The handle's offset from the body's own screen position — constant while it rests. */
  const offset = (engine: EditorEngine, name: string) => {
    const m = btn(engine, "move");
    const b = btn(engine, name);
    return { dx: b.x - m.x, dy: b.y - m.y };
  };
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it("sits on the cursor from the very first move, before any size change", () => {
    const { engine } = selectedPlanet();
    const start = btn(engine, "resize");
    const sizeBefore = engine.getBodies()[0]!.size;
    engine.pointerDown(start);
    const first = { x: start.x - 60, y: start.y - 35 };
    engine.pointerMove(first);
    // The first move only establishes the grab distance (LevelEditor.gd:431-433), so the size has
    // not moved yet — but the handle must already be under the cursor, with no lag frame.
    expect(engine.getBodies()[0]!.size).toBeCloseTo(sizeBefore, 6);
    expect(dist(btn(engine, "resize"), first)).toBeLessThan(0.5);
  });

  it("tracks the cursor exactly for the whole drag", () => {
    const { engine } = selectedPlanet();
    const start = btn(engine, "resize");
    engine.pointerDown(start);
    engine.pointerMove(start);
    for (const p of [
      { x: start.x - 250, y: start.y - 140 },
      { x: start.x + 90, y: start.y + 210 },
      { x: start.x - 12, y: start.y + 3 },
    ]) {
      engine.pointerMove(p);
      expect(dist(btn(engine, "resize"), p)).toBeLessThan(0.5);
    }
  });

  it("keeps tracking the cursor after size has clamped at its maximum", () => {
    const { engine, renderer } = selectedPlanet();
    const start = btn(engine, "resize");
    engine.pointerDown(start);
    engine.pointerMove(start);
    // Far enough out that `resizeStartSize + 0.1 * (dNow - grabDist)` overshoots the size clamp.
    const far = renderer.worldToScreen(
      { x: 1300 - 2000, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(far);
    expect(engine.getBodies()[0]!.size).toBe(40);
    expect(dist(btn(engine, "resize"), far)).toBeLessThan(0.5);
    // Still tracking once clamped: another move further out keeps the handle on the cursor.
    const further = renderer.worldToScreen(
      { x: 1300 - 3000, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(further);
    expect(engine.getBodies()[0]!.size).toBe(40);
    expect(dist(btn(engine, "resize"), further)).toBeLessThan(0.5);
  });

  it("follows the cursor for a sun too, which still has no velocity handle", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 1300, 900);
    engine.select(0);
    expect(engine.getOverlay().buttons.some((b) => b.name === "velocity")).toBe(
      false,
    );
    const start = btn(engine, "resize");
    engine.pointerDown(start);
    const p = { x: start.x - 180, y: start.y + 60 };
    engine.pointerMove(p);
    expect(dist(btn(engine, "resize"), p)).toBeLessThan(0.5);
  });

  // -- refusals: the override must fire for a resize drag and for nothing else ------------------

  it("REFUSES to move the resize handle during a VELOCITY drag", () => {
    const { engine } = selectedPlanet();
    const before = offset(engine, "resize");
    const velBtn = btn(engine, "velocity");
    engine.pointerDown(velBtn);
    const p = { x: velBtn.x + 220, y: velBtn.y + 130 };
    engine.pointerMove(p);
    expect(offset(engine, "resize")).toEqual(before);
    expect(dist(btn(engine, "resize"), p)).toBeGreaterThan(50);
  });

  it("REFUSES to pin the resize handle to the cursor during a MOVE drag", () => {
    const { engine } = selectedPlanet();
    const before = offset(engine, "resize");
    const moveBtn = btn(engine, "move");
    engine.pointerDown(moveBtn);
    const p = { x: moveBtn.x + 170, y: moveBtn.y - 90 };
    engine.pointerMove(p);
    // The handle rides along with the body, keeping its compass offset — it does not sit on the
    // cursor (the cursor is where the BODY now is, one compass offset away).
    expect(offset(engine, "resize")).toEqual(before);
    expect(dist(btn(engine, "resize"), p)).toBeGreaterThan(10);
  });

  it("REFUSES to follow a cursor with no button held", () => {
    const { engine } = selectedPlanet();
    const before = offset(engine, "resize");
    const start = btn(engine, "resize");
    engine.pointerMove({ x: start.x - 300, y: start.y - 200 });
    engine.pointerMove({ x: start.x + 300, y: start.y + 200 });
    expect(offset(engine, "resize")).toEqual(before);
  });

  it("REFUSES to keep following once the drag is released", () => {
    const { engine } = selectedPlanet();
    const before = offset(engine, "resize");
    const start = btn(engine, "resize");
    engine.pointerDown(start);
    engine.pointerMove(start);
    const far = { x: start.x - 240, y: start.y - 130 };
    engine.pointerMove(far);
    expect(dist(btn(engine, "resize"), far)).toBeLessThan(0.5);
    engine.pointerUp(far);
    // Back to its resting compass offset the instant the drag ends.
    expect(offset(engine, "resize")).toEqual(before);
    engine.pointerMove({ x: far.x - 40, y: far.y - 40 });
    expect(offset(engine, "resize")).toEqual(before);
  });
});
