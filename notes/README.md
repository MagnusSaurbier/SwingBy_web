# notes/ — working thought logs

One subfolder per feature or fix, named by a short slug, owned by whoever is working it:

```
notes/brake-flip-burn/log.md
notes/editor-canvas-interaction/log.md
...
```

Finished work moves to `notes/archive/` (see below) — nobody reads it by default, but it stays
discoverable by grepping a feature name when a later task needs to trace why something is the way
it is.

## Why this exists

An agent can be terminated at any moment — a usage limit, a container stop, a lost connection.
Code that was pushed survives; the *reasoning behind it* does not, and re-deriving it is the
expensive part. A fresh agent picking up a branch should not have to re-read the whole module to
rediscover a conclusion someone already reached.

These logs are that memory. They are working notes, not documentation — messy, append-only, and
written for whoever picks up next (possibly a fresh agent with none of the author's context, per
AGENTS.md's context-gathering process).

## What belongs in a log entry

- **Decisions and the reasoning behind them**, especially where the obvious choice was rejected.
  "Used X instead of Y because Y breaks Z."
- **Dead ends already ruled out.** Highest-value content here — it stops the next agent from
  spending an hour on something already disproven.
- **Findings from reading the code**, with file and line. "`physics.ts:87` zeroes acceleration
  inside the substep loop, so a per-tick zero is wrong."
- **Assumptions and open questions**, flagged as such.
- **Current state and the intended next step**, so a cold pickup knows where the author was
  standing.

Not: a restatement of the task description, or a narration of what the diff already shows.

## Cadence

Append after each meaningful substep, and always immediately *before* anything slow or risky (a
long build, a large refactor, a tricky change), so an interruption during that step leaves a
readable trail of what was being attempted.

Entries are timestamped and append-only. Never rewrite or tidy an earlier entry — a superseded
conclusion is itself useful information, so add a new entry saying it was superseded and why.

## `notes/archive/`

Logs, task descriptions, and results for finished work, moved here so nothing in `notes/`'s top
level is stale by default. Nothing here is force-read by any process — it exists so a future
agent tracing a specific decision can find it by searching a feature name, not so it gets read on
every new session.
