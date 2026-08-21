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

// A fresh engine always seeds exactly one player object (index 0) — see createEditorEngine's
// "else" branch in editor.ts. There is no "add player" tool (`armPlace("player")` is refused), so a
// test that needs the player at specific coordinates repositions the seeded one via a real move
// drag, rather than placing a new one.
function movePlayerTo(
  engine: EditorEngine,
  renderer: Renderer,
  wx: number,
  wy: number,
): void {
  const playerIndex = engine.getBodies().findIndex((b) => b.type === "player");
  const body = engine.getBodies()[playerIndex]!;
  const camera = engine.getCamera();
  const from = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
  engine.pointerDown(from); // selects the player + begins a move drag
  const to = renderer.worldToScreen({ x: wx, y: wy }, camera);
  engine.pointerMove(to);
  engine.pointerUp(to);
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
    // index 0 is the stage's permanent seeded player (elsewhere, at STAGE_CENTER) — the two planets
    // placed here land at indices 1 and 2, so the second (topmost) one wins at index 2.
    expect(engine.hitTest(screenPt)).toBe(2);
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
    expect(engine.getBodies()).toHaveLength(2); // the seeded player, plus this one
    expect(engine.getBodies()[1]!.x).toBeCloseTo(700, 6);
    expect(engine.getBodies()[1]!.y).toBeCloseTo(550, 6);
  });

  it("Escape cancels an armed placement without creating a body", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("sun");
    const pt = renderer.worldToScreen({ x: 100, y: 100 }, engine.getCamera());
    engine.pointerDown(pt);
    engine.cancelPlace();
    engine.pointerUp(pt);
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player
  });

  it('armPlace refuses "player" — the seeded player is the only one that will ever exist', () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("player");
    expect(engine.getPlaceType()).toBeNull(); // refused, no tool armed
    placeAt(engine, renderer, "player", 200, 0); // end-to-end: still a no-op
    expect(engine.getBodies()).toHaveLength(1);
  });

  it("newly placed sun defaults to gravity 1000 / size 18 / visible; planet defaults to gravity 0 / size 10; the seeded player matches", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 0, 0);
    placeAt(engine, renderer, "planet", 100, 0);
    const [player, sun, planet] = engine.getBodies();
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
    const body = engine.getBodies()[1]!;
    expect(body.x).toBeCloseTo(800, 6);
    expect(body.y).toBeCloseTo(650, 6);
  });

  it("velocity handle sets xVel/yVel = delta*0.01, matching LevelEditor.gd's handle_drag formula", () => {
    const { engine, renderer } = makeEngine();
    movePlayerTo(engine, renderer, 500, 500);
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
    engine.select(1);
    const overlay = engine.getOverlay();
    expect(overlay.buttons.some((b) => b.name === "velocity")).toBe(false);
  });

  it("resize handle scales size and, for non-player bodies, gravity via the cubic coupling", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 500, 500);
    engine.select(1);
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
    const body = engine.getBodies()[1]!;
    expect(body.size).toBeGreaterThan(18);
    expect(body.gravity).toBeCloseTo(body.size ** 3 * (1000 / 18 ** 3), 6);
  });

  it("resize does NOT scale gravity for the player (decision #6 — non-player only)", () => {
    const { engine, renderer } = makeEngine();
    movePlayerTo(engine, renderer, 500, 500);
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

  it("delete button removes the object and clears the goal if it was the deleted body", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 100, 0); // index 1 — index 0 is the seeded player
    engine.select(1);
    engine.setSelectedAsGoal();
    expect(engine.getGoalIndex()).toBe(1);
    const overlay = engine.getOverlay();
    const delBtn = overlay.buttons.find((b) => b.name === "delete")!;
    engine.pointerDown(delBtn);
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player remains
    expect(engine.getGoalIndex()).toBe(-1); // the goal body was deleted, not silently retargeted
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undo", () => {
  it("covers placement: N placements, N undos returns to just the seeded player", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 0, 0);
    placeAt(engine, renderer, "planet", 100, 0);
    placeAt(engine, renderer, "planet", 200, 0);
    expect(engine.getBodies()).toHaveLength(4);
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(3);
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(1); // the seeded player — never undo-able away
    expect(engine.undo()).toBe(false); // nothing left to undo
    expect(engine.canUndo()).toBe(false);
  });

  it("covers move, resize, and delete, each restoring exact prior state", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 500, 500);
    engine.undo(); // undo the placement's own snapshot push, back to just the seeded player — then re-place to start clean
    placeAt(engine, renderer, "sun", 500, 500);
    const afterPlace = engine.getBodies()[1]!;
    expect(afterPlace.x).toBe(500);

    // move
    engine.select(1);
    const camera = engine.getCamera();
    engine.pointerDown(renderer.worldToScreen({ x: 500, y: 500 }, camera));
    engine.pointerMove(renderer.worldToScreen({ x: 900, y: 900 }, camera));
    engine.pointerUp(renderer.worldToScreen({ x: 900, y: 900 }, camera));
    expect(engine.getBodies()[1]!.x).toBeCloseTo(900, 6);

    // resize
    const overlay = engine.getOverlay();
    const resizeBtn = overlay.buttons.find((b) => b.name === "resize")!;
    engine.pointerDown(resizeBtn);
    engine.pointerMove(resizeBtn);
    engine.pointerMove(
      renderer.worldToScreen({ x: 900 - 400, y: 900 }, camera),
    );
    engine.pointerUp(renderer.worldToScreen({ x: 900 - 400, y: 900 }, camera));
    const sizeAfterResize = engine.getBodies()[1]!.size;
    expect(sizeAfterResize).toBeGreaterThan(18);

    // delete
    engine.deleteAt(1);
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player

    // undo delete -> back with the resized body
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()).toHaveLength(2);
    expect(engine.getBodies()[1]!.size).toBeCloseTo(sizeAfterResize, 6);

    // undo resize -> size 18 again
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()[1]!.size).toBe(18);

    // undo move -> back at (500,500)
    expect(engine.undo()).toBe(true);
    expect(engine.getBodies()[1]!.x).toBe(500);
    expect(engine.getBodies()[1]!.y).toBe(500);
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

describe("save is refused for every invalid case", () => {
  it("'no player' is structurally impossible — the seeded player cannot be deleted", () => {
    const { engine } = makeEngine();
    engine.deleteAt(0); // refused
    expect(engine.getBodies()).toHaveLength(1);
    expect(engine.getBodies()[0]!.type).toBe("player");
    expect(engine.validateCurrent().ok).toBe(true);
  });

  it("'two players' is structurally impossible — armPlace refuses \"player\"", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "player", 100, 0); // no-op
    expect(engine.getBodies()).toHaveLength(1);
    expect(engine.validateCurrent().ok).toBe(true);
  });

  it("goal points at the player is refused", () => {
    const { engine, renderer } = makeEngine();
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

  it("goal.range <= 0 is refused", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 100, 0);
    engine.select(1);
    engine.setSelectedAsGoal();
    engine.setGoalRange(0);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("goal.range"))).toBe(true);
  });

  it("a level with no gravity source at all IS accepted — there is no such rule", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 100, 0); // default gravity 0, no sun placed
    engine.select(1);
    engine.setSelectedAsGoal();
    expect(engine.validateCurrent().ok).toBe(true);
  });

  it("a level with no target set (goalIndex -1) IS accepted — a target is only required to share", () => {
    const { engine } = makeEngine();
    expect(engine.getGoalIndex()).toBe(-1);
    expect(engine.validateCurrent().ok).toBe(true);
  });

  it("a valid, fully authored level IS accepted", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 400, 0);
    engine.select(1);
    engine.setSelectedAsGoal();
    engine.setGoalRange(80);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(true);
  });

  it("multiple simultaneous errors are ALL reported, not just the first", () => {
    const { engine } = makeEngine();
    // Goal pointing at the player AND a degenerate goal range, together.
    engine.select(0); // the player
    engine.setSelectedAsGoal();
    engine.setGoalRange(-5);
    const result = engine.validateCurrent();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes("must not reference the player")),
      ).toBe(true);
      expect(result.errors.some((e) => e.includes("goal.range"))).toBe(true);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
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
// Placement is one object per arm, and the placed object becomes the selection (repo-owner
// decision: repeat-place is explicitly NOT wanted). These pin the whole loop end to end so that
// adding repeat-place later has to be a deliberate act.
// ---------------------------------------------------------------------------

describe("placement places exactly one object per arm and selects it", () => {
  it("selects the placed object and disarms, and a second one needs re-arming", () => {
    const { engine, renderer } = makeEngine();
    expect(engine.getSelectedIndex()).toBe(-1);

    engine.armPlace("planet");
    const first = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(first);
    expect(engine.getOverlay().phantom).not.toBeNull();
    // Arming clears the selection, so the selection seen afterwards can only come from the commit.
    expect(engine.getSelectedIndex()).toBe(-1);

    engine.pointerDown(first);
    engine.pointerUp(first);
    // index 1: index 0 is the stage's seeded player.
    expect(engine.getBodies()).toHaveLength(2);
    expect(engine.getSelectedIndex()).toBe(1);
    expect(engine.getSelectedBody()!.type).toBe("planet");
    expect(engine.getPlaceType()).toBeNull();
    // Selected means the contextual handles are live on the new body.
    expect(engine.getOverlay().buttons.length).toBeGreaterThan(0);

    // REFUSAL: clicking again elsewhere must not place a second object off the same arm.
    const second = renderer.worldToScreen(
      { x: 2000, y: 1500 },
      engine.getCamera(),
    );
    engine.pointerMove(second);
    engine.pointerDown(second);
    engine.pointerUp(second);
    expect(engine.getBodies()).toHaveLength(2);

    // Re-arming is what places the second one, and the selection follows it.
    engine.armPlace("sun");
    engine.pointerMove(second);
    engine.pointerDown(second);
    engine.pointerUp(second);
    expect(engine.getBodies()).toHaveLength(3);
    expect(engine.getSelectedIndex()).toBe(2);
    expect(engine.getSelectedBody()!.type).toBe("sun");
    expect(engine.getPlaceType()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The resize handle follows the cursor for the duration of its own drag (repo-owner request),
// exactly as the velocity handle already did. Whenever no resize drag is in progress it rests at
// its derived polar position: 3 x the body's drawn radius, in the direction of the screen centre
// (overlay.ts `buttonPositions`). Two refusal tests below therefore assert the handle is at its
// DERIVED rest position rather than at a constant offset — the offset is only constant while
// neither the body's position nor its size changes, which a move drag and a resize drag both do.
// ---------------------------------------------------------------------------

describe("resize handle follows the cursor during its own drag", () => {
  function selectedPlanet(): { engine: EditorEngine; renderer: Renderer } {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "planet", 1300, 900);
    engine.select(1); // index 0 is the stage's seeded player
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
  /** Distance from the body to its resize handle, which at rest is `3 x drawn radius`. */
  const restDist = (engine: EditorEngine) =>
    dist(btn(engine, "move"), btn(engine, "resize"));
  /** `3 x drawn radius` for a planet, restated from render/bodies.ts:64. */
  const wantRestDist = (engine: EditorEngine) =>
    3 *
    Math.max(6, engine.getSelectedBody()!.size * 2.3 * engine.getCamera().zoom);

  it("sits on the cursor from the very first move, before any size change", () => {
    const { engine } = selectedPlanet();
    const start = btn(engine, "resize");
    const sizeBefore = engine.getBodies()[1]!.size;
    engine.pointerDown(start);
    const first = { x: start.x - 60, y: start.y - 35 };
    engine.pointerMove(first);
    // The first move only establishes the grab distance (LevelEditor.gd:431-433), so the size has
    // not moved yet — but the handle must already be under the cursor, with no lag frame.
    expect(engine.getBodies()[1]!.size).toBeCloseTo(sizeBefore, 6);
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
    expect(engine.getBodies()[1]!.size).toBe(40);
    expect(dist(btn(engine, "resize"), far)).toBeLessThan(0.5);
    // Still tracking once clamped: another move further out keeps the handle on the cursor.
    const further = renderer.worldToScreen(
      { x: 1300 - 3000, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(further);
    expect(engine.getBodies()[1]!.size).toBe(40);
    expect(dist(btn(engine, "resize"), further)).toBeLessThan(0.5);
  });

  it("follows the cursor for a sun too, which still has no velocity handle", () => {
    const { engine, renderer } = makeEngine();
    placeAt(engine, renderer, "sun", 1300, 900);
    engine.select(1); // index 0 is the stage's seeded player
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
    const moveBtn = btn(engine, "move");
    engine.pointerDown(moveBtn);
    const p = { x: moveBtn.x + 170, y: moveBtn.y - 90 };
    engine.pointerMove(p);
    // The handle rides along with the body at its derived rest distance — it does not sit on the
    // cursor (the cursor is where the BODY now is, one rest offset away). The offset's DIRECTION
    // does change, because moving the body changes where the screen centre is relative to it;
    // the distance, which is what the drag override would break, does not.
    expect(restDist(engine)).toBeCloseTo(wantRestDist(engine), 9);
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
    const start = btn(engine, "resize");
    engine.pointerDown(start);
    engine.pointerMove(start);
    const far = { x: start.x - 240, y: start.y - 130 };
    engine.pointerMove(far);
    expect(dist(btn(engine, "resize"), far)).toBeLessThan(0.5);
    engine.pointerUp(far);
    // Back to its derived resting position the instant the drag ends. Not `before`: the drag grew
    // `size`, and the rest distance is 3 x the drawn radius, so it legitimately rests further out
    // than it started. What must hold is that it is at the derived position and no longer moving
    // with the cursor.
    expect(restDist(engine)).toBeCloseTo(wantRestDist(engine), 9);
    const afterRelease = offset(engine, "resize");
    expect(dist(btn(engine, "resize"), far)).toBeGreaterThan(0.5);
    engine.pointerMove({ x: far.x - 40, y: far.y - 40 });
    expect(offset(engine, "resize")).toEqual(afterRelease);
  });
});

// ---------------------------------------------------------------------------
// The placement ghost follows the cursor while a place tool is armed, BEFORE any button is pressed.
// This is a regression fix, not new behaviour: `EditorOverlay.phantom`'s own doc comment ("armed
// `place` tool, cursor over the canvas") and notes/T-11-DRAFT/log.md decision #7 ("arm a tool+type
// from the toolbar, show a ghost following the cursor over the canvas, commit on mouseup") both
// specify it, but `phantom` was only ever assigned inside `pointerDown`.
// ---------------------------------------------------------------------------

describe("placement ghost follows the cursor while armed", () => {
  it("shows a ghost at the cursor as soon as a tool is armed and the pointer moves", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("planet");
    const screenPt = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(screenPt);
    const ghost = engine.getOverlay().phantom;
    expect(ghost).not.toBeNull();
    expect(ghost!.type).toBe("planet");
    const world = renderer.screenToWorld(screenPt, engine.getCamera());
    expect(ghost!.x).toBeCloseTo(world.x, 6);
    expect(ghost!.y).toBeCloseTo(world.y, 6);
  });

  it("tracks the cursor across successive moves, for every placeable type", () => {
    // "player" is excluded — it is not a placeable type (armPlace refuses it; see the
    // "armPlace refuses player" test).
    for (const type of ["sun", "planet"] as const) {
      const { engine, renderer } = makeEngine();
      engine.armPlace(type);
      for (const world of [
        { x: 1000, y: 700 },
        { x: 1600, y: 1100 },
        { x: 1301, y: 899 },
      ]) {
        const screenPt = renderer.worldToScreen(world, engine.getCamera());
        engine.pointerMove(screenPt);
        const ghost = engine.getOverlay().phantom;
        expect(ghost).not.toBeNull();
        expect(ghost!.type).toBe(type);
        expect(ghost!.x).toBeCloseTo(world.x, 6);
        expect(ghost!.y).toBeCloseTo(world.y, 6);
      }
    }
  });

  it("hides the ghost off-canvas but keeps the tool armed, and restores it on re-entry", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("sun");
    const screenPt = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).not.toBeNull();

    engine.pointerLeave();
    expect(engine.getOverlay().phantom).toBeNull();
    expect(engine.getPlaceType()).toBe("sun"); // still armed — leaving is not cancelling
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player — no commit happened

    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).not.toBeNull();
    expect(engine.getOverlay().phantom!.type).toBe("sun");
  });

  it("does not drop a press-and-drag placement when the pointer leaves the canvas mid-gesture", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("planet");
    const start = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerDown(start);
    engine.pointerLeave(); // wandering off-canvas with the button still held
    expect(engine.getOverlay().phantom).not.toBeNull();
    const end = renderer.worldToScreen(
      { x: 1500, y: 1000 },
      engine.getCamera(),
    );
    engine.pointerMove(end);
    engine.pointerUp(end);
    expect(engine.getBodies()).toHaveLength(2); // the seeded player, plus this one
    expect(engine.getBodies()[1]!.x).toBeCloseTo(1500, 6);
  });

  // -- refusals ---------------------------------------------------------------------------------

  it("REFUSES to show a ghost when no tool is armed", () => {
    const { engine, renderer } = makeEngine();
    const screenPt = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).toBeNull();
  });

  it("REFUSES to show a ghost once placement is cancelled, and places nothing on the next click", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("planet");
    const screenPt = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).not.toBeNull();

    engine.cancelPlace();
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).toBeNull();
    engine.pointerDown(screenPt);
    engine.pointerUp(screenPt);
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player
  });

  it("REFUSES to place anything on its own — a ghost is not a placement", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("sun");
    for (const world of [
      { x: 1000, y: 700 },
      { x: 1600, y: 1100 },
      { x: 900, y: 1300 },
      { x: 1300, y: 900 },
    ]) {
      engine.pointerMove(renderer.worldToScreen(world, engine.getCamera()));
    }
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player
    expect(engine.canUndo()).toBe(false);
  });

  it("REFUSES to show a ghost while the preview gate is up", () => {
    const { engine, renderer } = makeEngine();
    engine.setPreviewGate(true);
    engine.armPlace("planet"); // armPlace itself is gated
    expect(engine.getPlaceType()).toBeNull();
    const screenPt = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).toBeNull();
    expect(engine.getBodies()).toHaveLength(1); // just the seeded player

    // And a tool armed BEFORE the gate went up must not paint a ghost either.
    engine.setPreviewGate(false);
    engine.armPlace("planet");
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).not.toBeNull();
    engine.setPreviewGate(true);
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).toBeNull();
  });

  it("REFUSES to leave a stale ghost behind after the placement commits", () => {
    const { engine, renderer } = makeEngine();
    engine.armPlace("planet");
    const screenPt = renderer.worldToScreen(
      { x: 1300, y: 900 },
      engine.getCamera(),
    );
    engine.pointerMove(screenPt);
    engine.pointerDown(screenPt);
    engine.pointerUp(screenPt);
    // Repeat-place was decided against by the repo owner: the tool disarms on commit and the ghost
    // must go with it. See the "one object per arm" describe block below.
    expect(engine.getPlaceType()).toBeNull();
    engine.pointerMove(screenPt);
    expect(engine.getOverlay().phantom).toBeNull();
  });
});
