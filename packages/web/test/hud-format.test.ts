import { describe, expect, it } from "vitest";
import { TPS } from "@swingby/core";
import { formatDuration, ticksToMs } from "../src/hud/format.js";

describe("ticksToMs", () => {
  it("matches Math.round(ticks * 1000 / TPS) exactly, the same formula loop.ts/replay.ts use", () => {
    for (const ticks of [0, 1, 7, 144, 1001, 2110, 999999]) {
      expect(ticksToMs(ticks)).toBe(Math.round((ticks * 1000) / TPS));
    }
  });
});

describe("formatDuration", () => {
  it("formats M:SS.mmm with zero-padded seconds/millis", () => {
    expect(formatDuration(0)).toBe("0:00.000");
    expect(formatDuration(5)).toBe("0:00.005");
    expect(formatDuration(999)).toBe("0:00.999");
    expect(formatDuration(1000)).toBe("0:01.000");
    expect(formatDuration(14653)).toBe("0:14.653");
    expect(formatDuration(64653)).toBe("1:04.653");
    expect(formatDuration(605100)).toBe("10:05.100");
  });

  it("clamps negative input to 0 rather than producing a negative/garbled string", () => {
    expect(formatDuration(-5)).toBe("0:00.000");
  });

  it("rounds a fractional ms input before formatting", () => {
    expect(formatDuration(14653.4)).toBe("0:14.653");
    expect(formatDuration(14653.6)).toBe("0:14.654");
  });
});
