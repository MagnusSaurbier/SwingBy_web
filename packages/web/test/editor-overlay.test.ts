/**
 * T-11 DRAFT — overlay.ts: button geometry, hit-testing, and the paint pass. Uses the REAL
 * `createRenderer` (T-04) against a fake canvas for `worldToScreen`, never a reimplementation.
 */
import { describe, expect, it } from "vitest";
import type { Body } from "@swingby/core/types";
import { createRenderer, type Camera } from "../src/render/index.js";
import { makeFakeCanvas } from "../src/editor/__tests__/fakes.js";
import {
  buttonNamesFor,
  buttonPositions,
  hitTestButtons,
  hoverRadiusPx,
  paintEditorOverlay,
  resizeRestDirection,
  type EditorOverlay,
} from "../src/editor/overlay.js";

function makeBody(overrides: Partial<Body> = {}): Body {
  return {
    type: "planet",
    x: 500,
    y: 400,
    xVel: 0,
    yVel: 0,
    xAcc: 0,
    yAcc: 0,
    gravity: 100,
    size: 12,
    visible: true,
    anchored: false,
    angle: 0,
    turnSpeed: 0,
    isBoosting: false,
    isBraking: false,
    boostType: 0,
    ...overrides,
  };
}

describe("buttonNamesFor", () => {
  it("suns have no velocity handle; planets and players do", () => {
    expect(buttonNamesFor("sun")).not.toContain("velocity");
    expect(buttonNamesFor("planet")).toContain("velocity");
    expect(buttonNamesFor("player")).toContain("velocity");
  });
});

describe("buttonPositions + hitTestButtons", () => {
  const { canvas } = makeFakeCanvas(960, 600);
  const renderer = createRenderer(canvas);
  renderer.resize(960, 600, 1);
  const camera = { x: 500, y: 400, zoom: 1 };

  it("places the move button exactly on the body's screen position", () => {
    const body = makeBody();
    const buttons = buttonPositions(body, camera, renderer, null);
    const move = buttons.find((b) => b.name === "move")!;
    const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    expect(move.x).toBeCloseTo(center.x, 6);
    expect(move.y).toBeCloseTo(center.y, 6);
  });

  it("hitTestButtons finds the nearest button within its radius, null otherwise", () => {
    const body = makeBody();
    const buttons = buttonPositions(body, camera, renderer, null);
    const move = buttons.find((b) => b.name === "move")!;
    expect(hitTestButtons(buttons, { x: move.x + 2, y: move.y - 1 })).toBe(
      "move",
    );
    expect(
      hitTestButtons(buttons, { x: move.x + 500, y: move.y + 500 }),
    ).toBeNull();
  });
});

describe("hoverRadiusPx", () => {
  it("grows with body size and zoom, never below the minimum tappable target", () => {
    const small = hoverRadiusPx({ size: 4 }, 0.1);
    const large = hoverRadiusPx({ size: 40 }, 3);
    expect(small).toBeGreaterThanOrEqual(24);
    expect(large).toBeGreaterThan(small);
  });
});

describe("paintEditorOverlay", () => {
  it("draws without throwing for a representative overlay state, using only the documented context surface", () => {
    const { canvas, ctx } = makeFakeCanvas(960, 600);
    const renderer = createRenderer(canvas);
    renderer.resize(960, 600, 1);
    const camera = { x: 500, y: 400, zoom: 1 };
    const bodies: Body[] = [
      makeBody({ type: "sun", gravity: 1000 }),
      makeBody({ xVel: 0.5, yVel: -0.2 }),
    ];
    const overlay: EditorOverlay = {
      tool: "select",
      placeType: null,
      selectedIndex: 1,
      hoverIndex: 1,
      phantom: null,
      dragging: null,
      requiresReset: false,
      buttons: buttonPositions(bodies[1]!, camera, renderer, "move"),
      goalIndex: 1,
    };
    expect(() =>
      paintEditorOverlay(ctx, overlay, bodies, camera, renderer),
    ).not.toThrow();
    expect(ctx.calls).toContain("arc");
  });

  it("draws the placement ghost when phantom is set", () => {
    const { canvas, ctx } = makeFakeCanvas(960, 600);
    const renderer = createRenderer(canvas);
    renderer.resize(960, 600, 1);
    const camera = { x: 0, y: 0, zoom: 1 };
    const overlay: EditorOverlay = {
      tool: "place",
      placeType: "planet",
      selectedIndex: -1,
      hoverIndex: -1,
      phantom: { type: "planet", x: 10, y: 10 },
      dragging: null,
      requiresReset: false,
      buttons: [],
      goalIndex: 0,
    };
    const before = ctx.calls.length;
    paintEditorOverlay(ctx, overlay, [], camera, renderer);
    expect(ctx.calls.length).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// Live-drag override for the resize handle. Mirrors the `liveVelocityEnd` override that the
// velocity handle has always had — see `buttonPositions`'s doc comment in overlay.ts for why the
// resize half of the original "fixed compass arrangement" decision was overridden.
// ---------------------------------------------------------------------------

describe("buttonPositions — resize live-drag override", () => {
  const { canvas } = makeFakeCanvas(960, 600);
  const renderer = createRenderer(canvas);
  renderer.resize(960, 600, 1);
  const camera = { x: 500, y: 400, zoom: 1 };

  it("puts the resize button exactly at the live drag point", () => {
    const body = makeBody();
    const live = { x: 123.5, y: 456.25 };
    const resize = buttonPositions(
      body,
      camera,
      renderer,
      null,
      null,
      live,
    ).find((b) => b.name === "resize")!;
    expect(resize.x).toBeCloseTo(live.x, 6);
    expect(resize.y).toBeCloseTo(live.y, 6);
  });

  it("leaves move, velocity and delete untouched while resize is live-dragged", () => {
    const body = makeBody();
    const atrest = buttonPositions(body, camera, renderer, null);
    const dragged = buttonPositions(body, camera, renderer, null, null, {
      x: 123.5,
      y: 456.25,
    });
    for (const name of ["move", "velocity", "delete"] as const) {
      const a = atrest.find((b) => b.name === name)!;
      const d = dragged.find((b) => b.name === name)!;
      expect(d.x).toBeCloseTo(a.x, 6);
      expect(d.y).toBeCloseTo(a.y, 6);
    }
  });

  it("rests at the fixed compass position when no live drag point is given", () => {
    const body = makeBody();
    const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    for (const live of [undefined, null]) {
      const resize = buttonPositions(
        body,
        camera,
        renderer,
        null,
        null,
        live,
      ).find((b) => b.name === "resize")!;
      expect(resize.x).toBeLessThan(center.x);
      expect(resize.y).toBeCloseTo(center.y, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Resting direction for the resize handle (owner's polar rule). Approved and landed ahead of the
// rule that will consume it — see notes/feat-editor-canvas-interaction/PLAN-INCREMENT-3.md; the
// DISTANCE half is still with the owner, so `buttonPositions` does not call this yet.
// ---------------------------------------------------------------------------

describe("resizeRestDirection", () => {
  const camera = { x: 500, y: 400, zoom: 1 };

  it("points from the body toward the camera centre, normalised", () => {
    // Body left of and below the camera centre -> unit vector up and to the right.
    const d = resizeRestDirection({ x: 200, y: 800 }, camera);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    expect(d.x).toBeCloseTo(300 / Math.hypot(300, -400), 12);
    expect(d.y).toBeCloseTo(-400 / Math.hypot(300, -400), 12);
  });

  it("is a unit vector from every direction, and flips across the centre", () => {
    const left = resizeRestDirection({ x: 100, y: 400 }, camera);
    const right = resizeRestDirection({ x: 900, y: 400 }, camera);
    expect(left.x).toBeCloseTo(1, 12);
    expect(right.x).toBeCloseTo(-1, 12);
    for (const d of [left, right])
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
  });

  it("falls back to straight left when the body sits exactly on the camera centre", () => {
    const d = resizeRestDirection({ x: camera.x, y: camera.y }, camera);
    expect(d).toEqual({ x: -1, y: 0 });
  });

  it("REFUSES to produce NaN or Infinity for any degenerate input", () => {
    const cases = [
      { x: camera.x, y: camera.y },
      { x: camera.x + Number.MIN_VALUE, y: camera.y },
      { x: camera.x, y: camera.y - Number.MIN_VALUE },
    ];
    for (const body of cases) {
      const d = resizeRestDirection(body, camera);
      expect(Number.isFinite(d.x)).toBe(true);
      expect(Number.isFinite(d.y)).toBe(true);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// The resize handle's RESTING position: distance `3 x drawn radius`, direction toward the screen
// centre (repo owner, 2026-08-20 — chosen over "stay exactly where the drag was released"). The
// expected distances below are written out from `render/bodies.ts`'s own draw formulas rather than
// by calling `drawnRadiusPx`, so a wrong formula in overlay.ts cannot cancel itself out here:
//   sun    `drawSun`    radius = size * zoom                        (bodies.ts:34)
//   planet `drawPlanet` radius = max(6, size * 2.3 * zoom)          (bodies.ts:64)
//   player `drawPlayer` sprite half-height = 245/2 * ROCKET_SCALE * zoom, ROCKET_SCALE = 0.17
// ---------------------------------------------------------------------------

const PLAYER_HALF_HEIGHT_AT_ZOOM_1 = (245 / 2) * 0.17;

function expectedRestDistance(body: Body, zoom: number): number {
  const drawn =
    body.type === "sun"
      ? body.size * zoom
      : body.type === "planet"
        ? Math.max(6, body.size * 2.3 * zoom)
        : PLAYER_HALF_HEIGHT_AT_ZOOM_1 * zoom;
  return 3 * drawn;
}

describe("buttonPositions — resize resting position (3 x drawn radius, toward the screen centre)", () => {
  const { canvas } = makeFakeCanvas(960, 600);
  const renderer = createRenderer(canvas);
  renderer.resize(960, 600, 1);

  function restVector(body: Body, camera: Camera) {
    const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    const resize = buttonPositions(body, camera, renderer, null).find(
      (b) => b.name === "resize",
    )!;
    return {
      dx: resize.x - center.x,
      dy: resize.y - center.y,
      dist: Math.hypot(resize.x - center.x, resize.y - center.y),
      resize,
      center,
    };
  }

  it("rests at exactly 3 x the drawn radius, for every body type", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    for (const body of [
      makeBody({ type: "planet", size: 12, x: 200, y: 400 }),
      makeBody({ type: "sun", size: 18, x: 200, y: 400 }),
      makeBody({ type: "player", size: 10, x: 200, y: 400 }),
    ]) {
      const { dist } = restVector(body, camera);
      expect(dist).toBeCloseTo(expectedRestDistance(body, camera.zoom), 6);
    }
  });

  it("points from the body toward the screen centre, at three positions around it", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    for (const pos of [
      { x: 200, y: 400 }, // left of centre  -> handle points right
      { x: 500, y: 900 }, // below centre    -> handle points up
      { x: 900, y: 100 }, // up-right        -> handle points down-left
    ]) {
      const body = makeBody({ ...pos });
      const { dx, dy, dist } = restVector(body, camera);
      const want = resizeRestDirection(body, camera);
      expect(dx / dist).toBeCloseTo(want.x, 9);
      expect(dy / dist).toBeCloseTo(want.y, 9);
    }
  });

  it("overshoots the centre when 3 x drawn radius is longer than the distance to it — deliberate", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const body = makeBody({ type: "planet", size: 40, x: 480, y: 400 });
    const { resize, dist } = restVector(body, camera);
    const centreScreen = renderer.worldToScreen(
      { x: camera.x, y: camera.y },
      camera,
    );
    expect(dist).toBeCloseTo(3 * Math.max(6, 40 * 2.3), 6); // 276 px
    expect(resize.x).toBeGreaterThan(centreScreen.x); // past the centre, not clamped at it
  });

  it("rotates 180 degrees as the body crosses the screen centre", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const left = restVector(makeBody({ x: 400, y: 400 }), camera);
    const right = restVector(makeBody({ x: 600, y: 400 }), camera);
    expect(Math.sign(left.dx)).toBe(1);
    expect(Math.sign(right.dx)).toBe(-1);
    expect(left.dist).toBeCloseTo(right.dist, 6);
  });

  it("scales with zoom for suns and planets, exactly as the drawn body does", () => {
    for (const zoom of [0.25, 1, 3]) {
      const camera = { x: 500, y: 400, zoom };
      for (const body of [
        makeBody({ type: "planet", size: 20, x: 300, y: 400 }),
        makeBody({ type: "sun", size: 20, x: 300, y: 400 }),
      ]) {
        const { dist } = restVector(body, camera);
        expect(dist).toBeCloseTo(expectedRestDistance(body, zoom), 6);
      }
    }
  });

  it("tracks a size change with no drag at all", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const small = restVector(makeBody({ size: 6, x: 200, y: 400 }), camera);
    const big = restVector(makeBody({ size: 30, x: 200, y: 400 }), camera);
    expect(big.dist).toBeGreaterThan(small.dist);
    expect(big.dist / small.dist).toBeCloseTo((30 * 2.3) / (6 * 2.3), 6);
  });

  it("honours the planet's 6 px drawn floor — the distance bottoms out at 18 px, never zero", () => {
    const camera = { x: 500, y: 400, zoom: 0.12 };
    const { dist } = restVector(
      makeBody({ type: "planet", size: 4, x: 300, y: 400 }),
      camera,
    );
    expect(dist).toBeCloseTo(18, 6); // 3 x the max(6, ...) floor
  });

  it("is independent of `size` for the player, whose drawn size is too", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const a = restVector(
      makeBody({ type: "player", size: 4, x: 200, y: 400 }),
      camera,
    );
    const b = restVector(
      makeBody({ type: "player", size: 40, x: 200, y: 400 }),
      camera,
    );
    expect(a.dist).toBeCloseTo(b.dist, 9);
    expect(a.dist).toBeCloseTo(3 * PLAYER_HALF_HEIGHT_AT_ZOOM_1, 6);
  });

  it("stays finite and grabbable when the body sits exactly on the screen centre", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const body = makeBody({ x: camera.x, y: camera.y });
    const { resize, dx, dy } = restVector(body, camera);
    expect(Number.isFinite(resize.x)).toBe(true);
    expect(Number.isFinite(resize.y)).toBe(true);
    expect(Math.sign(dx)).toBe(-1); // the documented (-1, 0) fallback: straight left
    expect(dy).toBeCloseTo(0, 9);
    const buttons = buttonPositions(body, camera, renderer, null);
    expect(hitTestButtons(buttons, { x: resize.x, y: resize.y })).toBe(
      "resize",
    );
  });

  it("REFUSES to move while a live drag point is given — the drag override still wins", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const body = makeBody({ x: 200, y: 400 });
    const live = { x: 111.25, y: 222.5 };
    const resize = buttonPositions(
      body,
      camera,
      renderer,
      null,
      null,
      live,
    ).find((b) => b.name === "resize")!;
    expect(resize.x).toBeCloseTo(live.x, 6);
    expect(resize.y).toBeCloseTo(live.y, 6);
  });

  it("REFUSES to move the other three handles — move/velocity/delete keep the fixed compass", () => {
    const camera = { x: 500, y: 400, zoom: 1 };
    const body = makeBody({ x: 200, y: 900 });
    const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    const buttons = buttonPositions(body, camera, renderer, null);
    const byName = (n: string) => buttons.find((b) => b.name === n)!;
    expect(byName("move").x).toBeCloseTo(center.x, 6);
    expect(byName("move").y).toBeCloseTo(center.y, 6);
    expect(byName("velocity").x).toBeCloseTo(center.x + 44, 6);
    expect(byName("velocity").y).toBeCloseTo(center.y, 6);
    expect(byName("delete").x).toBeCloseTo(center.x, 6);
    expect(byName("delete").y).toBeCloseTo(center.y + 44, 6);
  });
});
