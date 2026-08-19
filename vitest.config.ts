import { configDefaults, defineConfig } from "vitest/config";

/**
 * Root Vitest config. Its only job is the `exclude` list — everything else stays on Vitest's
 * defaults, so test discovery is unchanged from when this project had no config file at all.
 *
 * Claude Code subagents get an isolated git worktree at `.claude/worktrees/<agent-id>/`, which is a
 * full checkout of THIS repo nested inside itself. Vitest's default exclude does not cover it, so
 * while an agent is running (or if a worktree is left behind) the entire suite is collected once
 * per worktree and every count multiplies — 828 tests reported as 2468 across three checkouts,
 * which is alarming until you notice the file list repeats. Worse, those copies are stale, so a
 * green run can be reporting on code that is not in the working tree.
 *
 * `.gitignore` already covers `.claude/worktrees/`, but git ignoring a path has no bearing on what
 * Vitest globs — the exclusion has to be stated here too.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
