import { describe, expect, it } from "vitest";
import { nearestCorner } from "../src/hud/hint-drag.js";

describe("nearestCorner", () => {
  it("picks top-left when the point is in the top-left quadrant", () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe("top-left");
  });

  it("picks top-right when the point is in the top-right quadrant", () => {
    expect(nearestCorner(900, 10, 1000, 800)).toBe("top-right");
  });

  it("picks bottom-left when the point is in the bottom-left quadrant", () => {
    expect(nearestCorner(10, 700, 1000, 800)).toBe("bottom-left");
  });

  it("picks bottom-right when the point is in the bottom-right quadrant", () => {
    expect(nearestCorner(900, 700, 1000, 800)).toBe("bottom-right");
  });

  it("resolves the exact center to bottom-right (a strict `<` boundary, consistent and deterministic)", () => {
    expect(nearestCorner(500, 400, 1000, 800)).toBe("bottom-right");
  });
});
