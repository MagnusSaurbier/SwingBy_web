/**
 * `encodeTape` / `decodeTape`.
 *
 * Round-trip correctness (`decodeTape(encodeTape(t))` deep-equals `t`) over 1,000 generated tapes
 * (notes/archive/T-02-TAPE/task.md DoD: "1,000 generated tapes"). This corpus used to also
 * include the 33 real solvability tapes; those were removed on feat/remove-gravity-softening
 * (recorded under the old softened gravity, now stale) — dropped here too rather than kept as
 * inert byte blobs, since `encodeTape`/`decodeTape` only care about `ReplayTape`'s shape
 * (ticks/boost/brake arrays), not about what physics produced it, and the generated corpus
 * already covers that shape space. Also: encoded size for a representative 60s run, and hostile
 * decode inputs (empty, truncated, invalid characters, non-string) — `decodeTape` must throw a
 * clear `Error`, never hang, never return silently-wrong data for those.
 */

import { describe, expect, it } from "vitest";

import { decodeTape, encodeTape } from "../../src/replay.js";
import type { ReplayTape } from "../../src/types.js";
import { benchTape, genTapes } from "./fixtures.js";

describe("round-trip: decodeTape(encodeTape(t)) deep-equals t", () => {
  const generated = genTapes(1000, 0x5eed, {
    maxTicks: 86400,
    maxTransitionsPerControl: 60,
  });
  const corpus: ReplayTape[] = generated;

  it(`round-trips exactly over ${corpus.length} generated tapes`, () => {
    expect(generated.length).toBe(1000);

    let okCount = 0;
    for (const tape of corpus) {
      const decoded = decodeTape(encodeTape(tape));
      expect(decoded).toEqual(tape);
      okCount++;
    }
    expect(okCount).toBe(corpus.length);
    console.log(
      `round-trip: ${okCount}/${corpus.length} tapes round-tripped exactly`,
    );
  });

  it("round-trips edge shapes: empty tape, ticks=0, single-tick tape, odd-length (still-held) arrays", () => {
    const edgeCases: ReplayTape[] = [
      { ticks: 0, boost: [], brake: [] },
      { ticks: 1, boost: [0], brake: [] },
      { ticks: 1, boost: [], brake: [0] },
      { ticks: 86400, boost: [0], brake: [] }, // max ticks, control held from the very first tick
      { ticks: 500, boost: [0, 1, 2, 3, 4], brake: [499] }, // dense deltas of 1, plus a trailing odd
    ];
    for (const tape of edgeCases) {
      expect(decodeTape(encodeTape(tape))).toEqual(tape);
    }
  });

  it("round-trips a tape at the max-transitions boundary (2000 total)", () => {
    const boost = Array.from({ length: 1000 }, (_, i) => i * 2);
    const brake = Array.from({ length: 1000 }, (_, i) => i * 2 + 1);
    const tape: ReplayTape = { ticks: 3000, boost, brake };
    expect(decodeTape(encodeTape(tape))).toEqual(tape);
  });
});

describe("encoded size — representative 60s (8,640-tick) run", () => {
  it("reports encoded byte length and bytes-per-transition", () => {
    const tape = benchTape();
    const transitions = tape.boost.length + tape.brake.length;
    const encoded = encodeTape(tape);
    // base64url: 4 chars encode 3 bytes, so byte length is derived from the string length.
    const byteLength = Math.floor((encoded.length * 3) / 4);
    console.log(
      `encoded size: ticks=${tape.ticks} transitions=${transitions} ` +
        `encodedChars=${encoded.length} approxBytes=${byteLength} ` +
        `bytesPerTransition=${(byteLength / transitions).toFixed(2)}`,
    );
    // Sanity bound, not a tight assertion: "tens of transitions -> a few hundred bytes" per
    // notes/archive/T-02-TAPE/task.md "Encoding". This is a regression guard against something
    // pathological (e.g. accidentally encoding one byte per tick instead of per transition), not
    // a size budget.
    expect(byteLength).toBeLessThan(1000);
    expect(decodeTape(encoded)).toEqual(tape);
  });
});

describe("decodeTape — hostile encoded input", () => {
  it("empty string decodes to an empty tape (not an error — a valid encoding of the zero tape)", () => {
    expect(decodeTape("")).toEqual({ ticks: 0, boost: [], brake: [] });
  });

  it("throws on a truncated encoding (valid prefix, cut off mid-varint-stream)", () => {
    const encoded = encodeTape(benchTape());
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
    expect(() => decodeTape(truncated)).toThrow();
  });

  it("throws on a single leftover base64url character (length % 4 === 1)", () => {
    expect(() => decodeTape("A")).toThrow();
    expect(() => decodeTape("ABCDA")).toThrow();
  });

  it("throws on invalid base64url characters", () => {
    expect(() => decodeTape("!!!!")).toThrow();
    expect(() => decodeTape("has spaces")).toThrow();
    expect(() => decodeTape("plus+and/slash")).toThrow(); // standard-base64 chars, not base64url
  });

  it("throws rather than hangs on a byte stream with an unterminated varint continuation bit", () => {
    // "____________" (12 underscores) decodes to bytes that are all 0x3f (continuation-bit-shaped
    // once combined) — specifically crafted so the very first varint never finds a terminating
    // byte (all payload bytes have the high bit set after decode). Rather than rely on exact
    // alphabet arithmetic, assert the general contract: this never hangs (test itself has a
    // timeout) and it throws.
    const pathological = "_".repeat(64); // plenty of bytes, all continuation-shaped
    expect(() => decodeTape(pathological)).toThrow();
  }, 1000);

  it("throws on non-string input even though the type signature says string", () => {
    // Defensive: a network boundary caller might hand decodeTape whatever `JSON.parse` produced.
    expect(() => decodeTape(null as unknown as string)).toThrow();
    expect(() => decodeTape(undefined as unknown as string)).toThrow();
    expect(() => decodeTape(42 as unknown as string)).toThrow();
    expect(() => decodeTape({} as unknown as string)).toThrow();
  });

  it("does not throw on a maximally long, but validly-shaped, encoded string (no hang)", () => {
    const boost = Array.from({ length: 1000 }, (_, i) => i * 2);
    const brake = Array.from({ length: 1000 }, (_, i) => i * 2 + 1);
    const tape: ReplayTape = { ticks: 86400, boost, brake };
    const start = performance.now();
    const decoded = decodeTape(encodeTape(tape));
    const elapsedMs = performance.now() - start;
    expect(decoded).toEqual(tape);
    expect(elapsedMs).toBeLessThan(50);
  });
});
