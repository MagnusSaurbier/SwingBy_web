import type { Body, World } from "@swingby/core/types";

export function makeBody(
  partial: Partial<Body> & { type: Body["type"] },
): Body {
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

/** Sun + two planets + player, roughly centered in the documented 0-2600 x 0-1800 world span. */
export function makeFixtureWorld(): World {
  const bodies: Body[] = [
    makeBody({
      type: "sun",
      x: 1300,
      y: 900,
      gravity: 40000,
      size: 24,
      visible: true,
    }),
    makeBody({
      type: "sun",
      x: 400,
      y: 300,
      gravity: 8000,
      size: 16,
      visible: false,
    }), // hidden sun
    makeBody({
      type: "planet",
      x: 1700,
      y: 900,
      gravity: 900,
      size: 14,
      angle: 0.4,
    }),
    makeBody({
      type: "planet",
      x: 1300,
      y: 500,
      gravity: 500,
      size: 10,
      angle: -1.1,
      anchored: true,
    }),
    makeBody({
      type: "player",
      x: 1100,
      y: 900,
      xVel: 0.5,
      yVel: -0.2,
      size: 12,
      boostType: 1,
    }),
  ];
  return {
    bodies,
    playerIndex: 4,
    goalIndex: 2,
    goalRange: 50,
  };
}
