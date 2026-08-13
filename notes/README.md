# notes/ — working thought logs

One subfolder per task, owned by that task's agent and nobody else:

```
notes/T-01-KEPLER/log.md
notes/T-03-ATLAS/log.md
...
```

## Why this exists

An agent can be terminated at any moment — a usage limit, a container stop, a
lost connection. Code that was pushed survives; the *reasoning behind it* does
not, and re-deriving it is the expensive part. A fresh agent picking up a branch
should not have to re-read 5,600 lines of GDScript to rediscover a conclusion
someone already reached.

These logs are that memory. They are working notes, not documentation — messy,
append-only, and written for whoever picks up next (possibly a fresh agent with
none of the author's context).

## What belongs in a log entry

- **Decisions and the reasoning behind them**, especially where the obvious
  choice was rejected. "Used X instead of Y because Y breaks Z."
- **Dead ends already ruled out.** Highest-value content here — it stops the
  next agent from spending an hour on something already disproven.
- **Findings from the reference implementation**, with file and line.
  "`PhysicsEngine.gd:87` zeroes acceleration inside the substep loop, so a
  per-tick zero is wrong."
- **Assumptions and open questions**, flagged as such.
- **Current state and the intended next step**, so a cold pickup knows where
  the author was standing.

Not: a restatement of the task doc, or a narration of what the diff already
shows.

## Cadence

Append after each meaningful substep, and always immediately *before* anything
slow or risky (a long build, a large refactor, a tricky port), so an
interruption during that step leaves a readable trail of what was being
attempted.

Entries are timestamped and append-only. Never rewrite or tidy an earlier
entry — a superseded conclusion is itself useful information, so add a new
entry saying it was superseded and why.
