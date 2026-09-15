import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_OPTIONS,
  difficultySettingsPatch,
} from "../src/ui/view-models.js";

describe("first-flight difficulty presets", () => {
  it("offers the three named aid levels in player-facing order", () => {
    expect(DIFFICULTY_OPTIONS).toEqual([
      {
        id: "easy",
        label: "Easy",
        summary: "Full projection",
        aid: "projection",
      },
      {
        id: "medium",
        label: "Medium",
        summary: "Trace",
        aid: "trace",
      },
      { id: "pro", label: "Pro", summary: "No help", aid: "none" },
    ]);
  });

  it.each([
    ["easy", { trail: true, showFuture: true }],
    ["medium", { trail: true, showFuture: false }],
    ["pro", { trail: false, showFuture: false }],
  ] as const)("maps %s to its exact aid settings", (difficulty, aids) => {
    expect(difficultySettingsPatch(difficulty)).toEqual({
      ...aids,
      hasSelectedDifficulty: true,
    });
  });
});
