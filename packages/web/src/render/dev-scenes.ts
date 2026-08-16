/**
 * Fixture worlds for the dev harness (dev.html/dev.ts) and for manual visual sweeps. Per this
 * task's brief: "Build your own fixture worlds ... rather than importing T-03 ATLAS's levels,
 * which are being written concurrently." No import of level.ts/levels.json/physics.ts anywhere
 * in this module — it hand-rolls `World`/`Body` directly against the frozen `types.ts` shape.
 */

import type { Body, World } from "@swingby/core/types";

function body(partial: Partial<Body> & { type: Body["type"] }): Body {
  return {
    type: partial.type,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    xVel: partial.xVel ?? 0,
    yVel: partial.yVel ?? 0,
    xAcc: partial.xAcc ?? 0,
    yAcc: partial.yAcc ?? 0,
    gravity: partial.gravity ?? 0,
    size: partial.size ?? 10,
    visible: partial.visible ?? true,
    anchored: partial.anchored ?? false,
    angle: partial.angle ?? 0,
    turnSpeed: partial.turnSpeed ?? 0,
    isBoosting: partial.isBoosting ?? false,
    isBraking: partial.isBraking ?? false,
    boostType: partial.boostType ?? 0,
  };
}

export interface Scene {
  name: string;
  world: World;
}

/** Sun + two planets + player — the "a sun + two planets + player is enough" baseline scene. */
export function twinSystemScene(): Scene {
  const world: World = {
    bodies: [
      body({ type: "sun", x: 1300, y: 900, gravity: 42000, size: 26 }),
      body({
        type: "planet",
        x: 1900,
        y: 900,
        gravity: 1200,
        size: 16,
        angle: 0.3,
        xVel: 0,
        yVel: 0.9,
      }),
      body({
        type: "planet",
        x: 1300,
        y: 450,
        gravity: 600,
        size: 11,
        angle: -0.8,
        anchored: true,
      }),
      body({
        type: "player",
        x: 950,
        y: 900,
        xVel: 0.1,
        yVel: -1.1,
        boostType: 0,
      }),
    ],
    playerIndex: 3,
    goalIndex: 1,
    goalRange: 55,
  };
  return { name: "Twin System", world };
}

/**
 * A sun the player can see, plus an invisible one (gravity !== 0, visible: false) bending the
 * trajectory unexplained — GameWorld.gd:811 `if bool(obj.get("visible", true))`. Exists so the
 * screenshot deliverable can show the invisible sun is genuinely never drawn, not just claimed.
 */
export function hiddenPullScene(): Scene {
  const world: World = {
    bodies: [
      body({
        type: "sun",
        x: 900,
        y: 900,
        gravity: 30000,
        size: 22,
        visible: true,
      }),
      body({
        type: "sun",
        x: 1900,
        y: 700,
        gravity: 22000,
        size: 20,
        visible: false,
      }),
      body({
        type: "planet",
        x: 2150,
        y: 1250,
        gravity: 500,
        size: 13,
        angle: 1.4,
      }),
      body({
        type: "player",
        x: 900,
        y: 1350,
        xVel: 1.0,
        yVel: -0.15,
        boostType: 2,
      }),
    ],
    playerIndex: 3,
    goalIndex: 2,
    goalRange: 50,
  };
  return { name: "Hidden Pull", world };
}

/** Dense multi-body system for a busy-frame perf/visual stress test (trail + prediction + boost). */
export function denseSystemScene(): Scene {
  const world: World = {
    bodies: [
      body({
        type: "sun",
        x: 1300,
        y: 900,
        gravity: 46000,
        size: 28,
        visible: true,
      }),
      body({
        type: "sun",
        x: 500,
        y: 1500,
        gravity: 9000,
        size: 14,
        visible: false,
      }),
      body({
        type: "planet",
        x: 1900,
        y: 900,
        gravity: 1400,
        size: 17,
        angle: 0.2,
        xVel: 0,
        yVel: 1.0,
      }),
      body({
        type: "planet",
        x: 700,
        y: 700,
        gravity: 800,
        size: 12,
        angle: 2.1,
        anchored: true,
      }),
      body({
        type: "planet",
        x: 1600,
        y: 1500,
        gravity: 650,
        size: 10,
        angle: -0.5,
        xVel: -0.6,
        yVel: 0,
      }),
      body({
        type: "player",
        x: 1300,
        y: 500,
        xVel: 1.6,
        yVel: 0,
        boostType: 3,
        isBoosting: true,
      }),
    ],
    playerIndex: 5,
    goalIndex: 2,
    goalRange: 60,
  };
  return { name: "Dense System", world };
}

export function allScenes(): Scene[] {
  return [twinSystemScene(), hiddenPullScene(), denseSystemScene()];
}
