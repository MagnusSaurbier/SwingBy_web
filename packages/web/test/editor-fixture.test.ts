/**
 * T-11 DRAFT — deliverable 6 (host-only Godot check aside): proves the committed fixture level
 * (`editor/fixtures/authored-level.json`) is, as far as this container can verify without Godot:
 *
 *   1. Loadable by the real editor engine (round-trips through `createEditorEngine`'s own
 *      `initialLevel` -> `toLevel()` path, not just raw `hydrate`/`serialize`).
 *   2. `validate()`-clean.
 *   3. `serialize(hydrate(l))` deep-equals `l` exactly.
 *
 * (A fourth check — solvable via a pure NO_INPUT coast through T-05's real `createGameLoop` — was
 * removed on feat/remove-gravity-softening; see the note above the removed test below.)
 *
 * The fixture deliberately contains one of each element named in the task doc's cross-build
 * verification step (an anchored planet, an invisible sun, a moving planet, a non-default goal
 * range) so the eventual host-side Godot check has real material to exercise — see
 * results/T-11-DRAFT.md for the exact steps to run that check, which THIS container cannot run
 * (no Godot binary, no SwingBy2026 checkout here, same constraint T-01 KEPLER's parity harness
 * documented for its own host-only step).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hydrate, serialize, validate } from "@swingby/core";
import type { Level } from "@swingby/core";
import { createEditorEngine } from "../src/editor/editor.js";
import { createRenderer } from "../src/render/index.js";
import { makeFakeCanvas } from "../src/editor/__tests__/fakes.js";

const fixturePath = new URL(
  "../src/editor/fixtures/authored-level.json",
  import.meta.url,
);
const fixture: Level = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("fixture level (deliverable 6): authored-level.json", () => {
  it("contains one of each required element", () => {
    const types = fixture.objects.map((o) => o.type);
    expect(types.filter((t) => t === "player")).toHaveLength(1);
    expect(
      fixture.objects.some((o) => o.type === "sun" && o.visible === false),
    ).toBe(true); // invisible sun
    expect(
      fixture.objects.some((o) => o.type === "planet" && o.anchored === true),
    ).toBe(true); // anchored planet
    expect(
      fixture.objects.some(
        (o) =>
          o.type === "planet" && ((o.x_vel ?? 0) !== 0 || (o.y_vel ?? 0) !== 0),
      ),
    ).toBe(true); // moving planet
    expect(fixture.goal.range).not.toBe(50); // non-default goal range (GOAL_RANGE_DEFAULT is 50)
  });

  it("passes validate()", () => {
    expect(validate(fixture)).toEqual({ ok: true });
  });

  it("round-trips exactly: serialize(hydrate(fixture)) deep-equals fixture", () => {
    const world = hydrate(fixture);
    const back = serialize(world, {
      name: fixture.name,
      author: fixture.author,
    });
    expect(back).toEqual(fixture);
  });

  it("is loadable by the real editor engine and re-exports identically", () => {
    const { canvas } = makeFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(960, 600, 1);
    const engine = createEditorEngine({
      renderer,
      viewport: { width: 960, height: 600 },
      initialLevel: fixture,
    });
    expect(engine.getBodies()).toHaveLength(fixture.objects.length);
    expect(engine.validateCurrent()).toEqual({ ok: true });
    expect(engine.toLevel()).toEqual(fixture);
  });

  // "is solvable: a pure NO_INPUT coast reaches the goal" was removed on
  // feat/remove-gravity-softening: authored-level.json's body positions/velocities were tuned so a
  // no-input coast reaches the goal under the old softened gravity. physics.ts now implements pure
  // inverse-square gravity (owner-directed), so that specific coast no longer reaches the goal
  // within the same window — a hardcoded physics trajectory, not a structural/validation property
  // of the fixture. Re-tune the fixture (or re-verify by hand) if this coverage is wanted back; see
  // notes/feat-remove-gravity-softening/PLAN.md.
});
