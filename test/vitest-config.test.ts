import { describe, expect, it } from "vitest";

import config from "../vitest.config.js";

/**
 * Regression coverage for agent worktrees being collected by the root suite.
 *
 * Claude Code subagents work in an isolated git worktree at `.claude/worktrees/<agent-id>/` — a
 * full checkout of this repo nested inside itself. Vitest's default `exclude` does not cover that
 * path, so with a worktree present the whole suite was collected once per worktree: 828 tests
 * reported as 2468 across three checkouts. The symptom is easy to misread as "the suite grew",
 * because every file simply appears two or three times in the list.
 *
 * The real hazard is not the inflated number. Those nested checkouts hold a DIFFERENT commit, so a
 * green run could be reporting on code that is not in the working tree at all.
 *
 * `.gitignore` covers `.claude/worktrees/`, but git ignoring a path says nothing about what Vitest
 * globs — the exclusion has to exist in the Vitest config as well, which is what this asserts.
 * Deleting the exclude line makes this test fail.
 */
describe("root vitest config", () => {
  const exclude = config.test?.exclude ?? [];

  it("excludes Claude Code agent worktrees from test discovery", () => {
    expect(exclude).toContain("**/.claude/**");
  });

  it("keeps Vitest's default exclusions rather than replacing them", () => {
    // Narrowing `exclude` to only the custom pattern would drag node_modules and dist back in.
    expect(exclude).toContain("**/node_modules/**");
    expect(exclude).toContain("**/dist/**");
  });
});
