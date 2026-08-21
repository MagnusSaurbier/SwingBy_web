# Standing instructions for agents

This file governs how work happens in this repo — how a session gets context, how it proposes and
verifies changes, how it pushes. `CLAUDE.md` governs writing style. Both apply.

**Workflow:** the owner describes a task to a fresh session with no prior context. That session
reads [README.md](README.md), follows its pointers into whatever it actually needs, explores the
code directly, and gets to work. For a task large enough to split, it may spawn 1-4 subsessions,
each covering a different slice of the work and each sourcing its own context the same way — see
"Splitting work across subsessions" below. There is no separate review/approval agent in this
loop; the owner is the one who signs off on a plan for anything non-trivial.

## Getting context for a task

1. **Read [README.md](README.md).** It is short by design and stays that way — a router, not a
   briefing. It states the toolchain, the standing constraints that apply to every task regardless
   of domain, and a table of the `docs/` files with a one-line trigger for each ("read this when
   your task touches X").
2. **Open only the `docs/` files whose trigger matches your task.** A UI change does not need
   `docs/PHYSICS.md`; a physics change does not need `docs/INFRA.md`. Each doc ends by naming the
   exact files it describes — that is where to go next, not further doc-reading.
3. **Read the code.** Docs describe contracts and non-obvious rationale; they are not a substitute
   for reading the function you are about to change. `Glob`/`Grep` the relevant package directly
   once you know roughly where to look.
4. **Check `notes/archive/` only if you're tracing a specific past decision** — a "why is this
   built this way" question, not routine reading. It is not force-read for a reason: most tasks do
   not need it, and reading it by default would defeat the point of keeping it out of the way.
   `notes/README.md` explains the convention for writing new entries as you work.

Do not read more than the task needs. The router in README.md exists specifically so you don't
have to open every doc "just in case" — trust the one-line triggers, and go back for more only if
you hit something the docs said would be explained elsewhere.

### Keep the docs truthful

If your change adds or changes an architectural fact, a type/function contract, a physics
equation, or anything else a future context-gathering pass would need to find, update the
relevant file under `docs/` (or README's router table, if you added something new enough to need
its own entry) **in the same PR**. A doc that quietly drifts from the code defeats the entire
point of this process — a future agent trusting it wastes exactly the time these docs exist to
save. If you're not sure whether something rises to "architectural fact," err toward writing the
one sentence; it's cheap compared to a stale doc misleading a fresh session later.

### Splitting work across subsessions

Only spawn a subsession for a genuinely separable slice of work — parallelizing because a task
*can* be split is not a reason to split it. When you do:

- **Don't do the subsession's context-gathering for it.** Its brief should state the task slice,
  which files/directories it owns (so two subsessions never write the same file), and anything you
  learned that it could not cheaply re-derive from the task text and the docs router itself. If the
  task is already fully specified by what you're handing over and the docs/code are there for the
  subsession to read, don't pre-read them yourself first "to be safe" — that's the same work done
  twice for no benefit. Point it at README.md and let it run the same process you just did.
- **Do** pass along anything genuinely expensive to rediscover: a measurement you already took, a
  dead end you already ruled out, an API detail you had to dig for that isn't obviously findable
  from the docs' one-line pointers.
- Give each subsession a disjoint set of files. A stray edit to a file another subsession owns is
  the one failure mode that costs someone else their work.

## Push every substep — the remote is your only backup

**A session can be terminated at any moment, without warning and without a chance to clean up.** A
usage limit, a container stop, a lost connection — from your side these are indistinguishable from
the process simply ceasing. There is no "save on exit." Anything not pushed is gone.

So treat `git push` as an autosave, not as a delivery step:

```bash
# In your first few minutes — before any real work:
git checkout -b feat/<slug>   # or fix/<slug>
git commit --allow-empty -m "start: <task>"
git push -u origin feat/<slug>

# Then after every meaningful substep, as often as every few minutes:
git add -A && git commit -m "wip: <what you just did>" && git push
```

**Push after each of these, at minimum:**

- The branch exists and you've written down what you're about to do
- Any file is created, even empty or stubbed
- A function or module is written, even before it compiles
- Types check, or tests run for the first time
- A test passes, or a measurement is taken (put the number in the commit message)
- Any decision you would otherwise have to re-derive
- Immediately before anything slow or risky — a long build, a large install, a big refactor

Commit messages during this phase are notes to whoever picks up your branch, possibly a fresh
session with none of your context. `wip: substepCount fix, verified against the 33 built-in
levels` is worth writing. `wip` alone is not.

**Do not** wait for a clean state to push. Broken, half-finished, and failing-tests are all fine on
your branch — that is what a task branch is for. A messy pushed branch is recoverable; a perfect
unpushed one is not. Never `git stash` work you have not pushed, and never leave a long stretch of
work uncommitted because "it isn't done yet."

## Standing rules

1. **`packages/core/src/types.ts` and `constants.ts` are the shared contract.** Changing them
   affects every consumer across both packages — do it deliberately, and update
   `docs/INTERFACES.md` in the same commit, not as an afterthought.
2. **Never use `Math.pow` in the physics path.** See [docs/GAME.md §4](docs/GAME.md#4-conventions).
3. **`packages/core` stays zero-dependency** and must run in Node as well as the browser.
4. **Respect the deliberate.** Code carrying a comment saying not to change it (`pointer-events:
   none` declarations, an `isInteractiveTarget` guard, a tolerance pinned to a measured value) was
   put there to fix something someone already paid for. Read the comment before "cleaning it up."

## Plan before code, for anything non-trivial

A quick, well-scoped fix with an obvious shape doesn't need a formal plan — just do it, verify it,
push it. For anything larger — a new feature, a change whose blast radius isn't obvious, anything
touching physics — write down the plan and get the owner's go-ahead before implementing. Use plan
mode for this rather than starting to edit files speculatively.

**For a bugfix, the plan covers:**
- the symptom, and the exact repro that produces it (reproduce under the conditions it was
  actually reported in — a bug reported on mobile is not reproduced by a desktop click)
- the root cause, **with the evidence that proves it** — not a hypothesis that fits
- the proposed change: which files, what shape, and why that is the *minimal* fix
- blast radius: what else touches this code, what could regress
- the regression test, and why it will fail without the fix

**For a feature, swap the first two for:**
- **what the feature does**, stated concretely enough to be checked off later
- **what it deliberately does not do** — the scope boundary. Features sprawl in a way bugs don't;
  a written scope boundary is what makes "that was not in scope" a statement of fact later.
- the surface it adds (routes, UI, persisted state, interfaces) and how each follows a pattern
  already in the repo rather than inventing a parallel one
- anything it changes for existing users — saved data, URLs, defaults, behaviour people rely on
- **whether it touches physics.** If it does, say so loudly: level solvability was hand-verified
  against the current physics constants, and a change that perturbs the simulation can silently
  make an authored level unsolvable.

A plan is not ready if the cause is asserted rather than demonstrated, the fix is broader than the
cause requires, the blast radius is unexamined, or the regression test would pass without the fix
(then it documents the bug, it doesn't cover it).

**Every bugfix carries a regression test that fails without the fix**, with before/after numbers
so the test is shown to cover the bug rather than merely accompany it. **A feature carries tests
for the behaviour it adds, including what it should refuse to do.** There is no jsdom here —
CSS-level bugs assert on rule text; see `packages/web/test/ui-toggle-css.test.ts` for the pattern.

**Sweep for siblings of the root cause.** When you find a cause, look for where else it applies
and report what you found — including "nothing else."

## Honesty

Do not claim a check you did not run, a viewport you did not open, or a gate whose number you did
not watch. Do not weaken an assertion or tolerance to get past a failure — if a threshold is
genuinely wrong, say so and leave it failing rather than loosening it quietly. Do not invent test
data, fixtures, or reference values to make a suite pass; a green suite built on fabricated ground
truth is worse than a red one, because it destroys the signal everyone else relies on. If something
is blocked or still broken after your fix, say so plainly — including in the plan, where "I could
not reproduce the reported symptom" is a legitimate and useful finding.

This container has no phone and no GPU, and may have no live database or deploy credentials.
Where you cannot check something, say so in the PR rather than claiming it. A task reported
**blocked** is cheap. A task falsely reported **done** costs someone a day of debugging built on a
false premise.

## Delivering

```bash
git push
gh pr create --fill
```

Your PR description must cover:

- What you built
- **Every measured number relevant to the change.** "Fast" is not a measurement; "3.1 ms" is.
- What you verified, and *how*
- Anything you could **not** verify, and why
- Whether this PR should have updated something in `docs/` and, if so, that it did

## Checking in

Post brief progress updates as you finish meaningful substeps, not only at the end. If you hit a
genuine fork in the road — an ambiguous requirement, a missing credential, a contradiction between
documents — ask rather than guessing.
