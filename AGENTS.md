# Standing instructions for agents

You are implementing **one** task of a fourteen-task parallel port. Work autonomously and finish it.

## Setup — read this part carefully, work has already been lost to it once

**Clone into `/workspace` and work there.** It is the only directory mounted from the host. Anything
you write anywhere else — `/tmp`, your home directory — is inside the container and **evaporates the
moment the container stops**, including when you hit a usage limit mid-task.

```bash
cd /workspace
git clone https://github.com/MagnusSaurbier/SwingBy_web.git
cd SwingBy_web
npm install
```

Then read, in this order: [README.md](README.md), [PROJECT.md](PROJECT.md),
[INTERFACES.md](INTERFACES.md), and finally your own task document in [`tasks/`](tasks/).

Those documents are authoritative. Your task document ends with **Deliverables**, **Definition of
done**, and **How to verify** — all three are the spec, not suggestions.

## Push every substep — the remote is your only backup

**You can be terminated at any moment, without warning and without a chance to clean up.** A shared
usage limit, a container stop, a lost connection — from your side these are indistinguishable from
the process simply ceasing. There is no "save on exit". Anything not pushed is gone.

So treat `git push` as an autosave, not as a delivery step:

```bash
# In your first few minutes — before any real work:
git checkout -b task/<your-task-slug>
git commit --allow-empty -m "start: <task>"
git push -u origin task/<your-task-slug>

# Then after every meaningful substep, as often as every few minutes:
git add -A && git commit -m "wip: <what you just did>" && git push
```

**Push after each of these, at minimum:**

- The branch exists and you have read the task document
- Any file is created, even empty or stubbed
- A function or module is written, even before it compiles
- Types check, or tests run for the first time
- A test passes, or a measurement is taken (put the number in the commit message)
- Any decision you would otherwise have to re-derive
- Immediately before anything slow or risky — a long build, a large install, a big refactor

Commit messages during this phase are notes to whoever picks up your branch, possibly a fresh agent
with none of your context. `wip: substepCount ported, matches GDScript for 3-body case` is worth
writing. `wip` alone is not.

**Do not** wait for a clean state to push. Broken, half-finished, and failing-tests are all fine on
your branch — that is what a task branch is for. A messy pushed branch is recoverable; a perfect
unpushed one is not. Never `git stash` work you have not pushed, and never leave a long stretch of
work uncommitted because "it isn't done yet."

If your task involves a long-running step, push *before* starting it and note in the commit what you
are about to attempt, so an interruption during that step leaves a readable trail.

This is not bureaucracy. A previous run of three agents was killed by a shared usage limit about
seven minutes in. All three had done real work; none had pushed, and all had cloned outside
`/workspace`. Nearly everything was lost, and only one file was recoverable — by digging it out of a
stopped container's filesystem. Your work is not "done" when it is correct. It is done when it is
**pushed**.

## Rules

1. **Write only files your task owns.** The ownership table is in
   [INTERFACES.md](INTERFACES.md#file-ownership). Before committing, run `git diff --name-only` and
   confirm every path is yours. Fourteen agents are working this repo in parallel; a stray edit to
   someone else's file is the one failure mode that costs other people their work.
2. **`packages/core/src/types.ts` and `constants.ts` are FROZEN.** Never edit them. If you believe
   one is wrong, say so in your PR and work around it — do not change it.
3. **Code against interfaces, stub dependencies.** Do not wait for another task. Every task document
   has a "working standalone / working without T-xx" section explaining how.
4. **`reference/` is read-only.** Never edit it, never import from it. Copy what you need into a
   path you own. See [reference/README.md](reference/README.md).
5. **Never use `Math.pow` in the physics path.** See [PROJECT.md §4](PROJECT.md#4-conventions).
6. **`packages/core` stays zero-dependency** and must run in node as well as the browser.

## Bugfix procedure: reproduce, propose, get a go, then code

Every bugfix in this repo runs through three roles. This applies however small the fix looks.

### The three roles

**The dispatcher** — the session talking to the human. It passes on the bug *as reported*, plus the
constraints and the standards. It does **not** investigate the bug, diagnose the cause, or design
the fix first. A pre-baked diagnosis handed to a worker is worse than none: it anchors the worker on
a theory it did not test, and the worker's own judgment — the reason it was dispatched — goes
unused. Hand over the report and the rules, not a solution.

**The orchestrator** — a separate Opus 5 agent, never the dispatcher. It reviews proposed
implementation plans and approves them, reviews finished branches, runs the gates itself, and
merges. It does **not** write the fix; if it finds itself editing the code under review, the review
has stopped being a review.

**Workers** — one bug each, on their own branch. They investigate, propose, wait, implement, verify.

### The gate: no code before an approved plan

A worker writes no fix — not a "quick try", not a spike left in the tree — until the orchestrator
has approved a plan. Reproduction and reading code come first and need no approval; changing
behaviour does.

Worker sequence:

1. **Branch and push.** `fix/<short-slug>` from `main`, empty start commit, pushed immediately.
2. **Reproduce**, under the conditions the bug was actually reported in. A bug reported on mobile is
   not reproduced by a desktop click: taps dispatch pointer/touch events and a synthesized `click`
   may never arrive, so a desktop check passes and proves nothing. Emulate the reported environment
   (`hasTouch`, mobile viewport, `locator.tap()`), and test landscape as well as portrait. Chromium
   and Playwright are preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run
   `playwright install`.
3. **Write the implementation plan** and submit it to the orchestrator. It must cover:
   - the symptom, and the exact repro that produces it
   - the root cause, **with the evidence that proves it** — not a hypothesis that fits
   - the proposed change: which files, what shape, and why that is the *minimal* fix
   - blast radius: what else touches this code, what could regress
   - alternatives considered and why rejected
   - the regression test, and why it will fail without the fix
   - the verification matrix: what gets checked, at which viewports/conditions
   - open questions, risks, and anything that might need the human
4. **Stop and wait.** Do not start implementing while the plan is in review.
5. **On GO, implement exactly the approved plan.** If the code turns out to disagree with the plan —
   the cause was deeper, the minimal fix is bigger — stop and re-submit. Do not quietly widen scope.
6. **Verify, push, report.**

### What the orchestrator checks

Approve on evidence, not plausibility. A plan is not ready if:

- the cause is asserted rather than demonstrated ("likely", "should be", no repro output)
- the fix is broader than the cause requires, or refactors code the bug does not touch
- the blast radius is unexamined, or touches protected code (see Rules) without saying so
- the regression test would pass without the fix — then it documents the fix, it does not cover it
- verification does not include the conditions the bug was reported in
- a sibling instance of the same root cause is plausible and unaddressed

Verdicts are **GO**, **REVISE** (with what is missing), or **REJECT** (with why the approach is
wrong). Say which. "Looks good" is not a verdict.

On completion the orchestrator reads the diff itself, re-runs every gate rather than trusting the
worker's numbers, checks the claimed verification actually happened, and then merges — or sends it
back. Numbers that do not reproduce are a REVISE, not a rounding error.

### Standing rules for every bugfix

- **Never fix a bug directly on `main`, and never merge your own work.** Workers do not open pull
  requests and do not merge; the orchestrator merges.
- **Every bugfix carries a regression test that fails without the fix.** State the before/after
  numbers so the test is shown to cover the bug rather than merely accompany it. There is no jsdom
  here — CSS-level bugs assert on rule text; see `packages/web/test/ui-toggle-css.test.ts`.
- **Sweep for siblings of the root cause.** Three fixes running (T-09's `hud.css`, `52c43e9`'s
  toggles, `8757d8e`'s touch guard) were each one instance of a general failure mode. When you find
  a cause, look for where else it applies and report what you found — including "nothing else".
- **Respect the deliberate.** Code carrying a comment saying not to change it (the `pointer-events:
  none` declarations, the `isInteractiveTarget` guard) was put there to fix a bug someone already
  paid for. Do not "clean it up".
- **Report at milestones**, each ending with what you are doing next: plan submitted, go received,
  fix pushed, verification complete. A wrong turn caught at milestone two is cheap; at the end it is
  not.
- Write the commit message so it explains the mechanism, not just the symptom. `git show 52c43e9`
  is the standard to match.

### Honesty

Do not claim a check you did not run, a viewport you did not open, or a gate whose number you did
not watch. Do not weaken an assertion to get green. If something is blocked or still broken after
your fix, say so plainly — including in the plan, where "I could not reproduce the reported symptom"
is a legitimate and useful finding. A blocked report is cheap. A false "verified" is expensive,
because the human finds it on their phone.

## Delivering

Your branch should already exist and already be pushed (see Setup). To finish:

```bash
git push
gh pr create --fill
```

### If a salvage branch exists for your task

Check `git branch -r | grep salvage`. A branch named `salvage/<your-task>-partial` holds work
recovered from an earlier interrupted run. It is **unverified prior art**: it compiled at most, no
tests ran against it, and nobody has checked it against the reference.

Read it if you like, but you own the outcome. Do not assume it is correct, and do not copy it in
wholesale to save time — an inherited bug you did not write is still a bug you shipped. If you do
use any of it, say so in your PR and say what you verified.

Your PR description must cover:

- What you built
- **Every measured number your task asks for.** "Fast" is not a measurement; "3.1 ms" is.
- Which Definition-of-done items you verified, and *how* you verified each
- Anything you could **not** verify, and why

## Honesty matters more than completion

This container has **no Godot, no browser, no phone, no GPU, and no database.** Several tasks have
criteria that need those. Where you cannot check something, say so plainly in the PR and in
`results.txt`. Do not claim it.

Specifically, do **not**:

- Invent test data, fixtures, or reference traces to make a suite pass. A green suite built on
  fabricated ground truth is far worse than a red one, because it destroys the signal everyone else
  is relying on.
- Weaken an assertion or tolerance to get past a failure. If a threshold is genuinely wrong, say so
  and leave it failing.
- Mark a Definition-of-done box as met because it "should" be. Mark it met because you watched it
  pass.
- Delete or skip another task's test to make your own run green.

A task reported **blocked** is cheap. A task falsely reported **done** costs someone a day of
debugging built on a false premise. If you are stuck or the spec looks wrong, ask — the human is
reachable, and asking is a success, not a failure.

## Checking in

Post brief progress updates as you finish meaningful substeps, not only at the end. If you hit a
genuine fork in the road — an ambiguous requirement, a missing credential, a contradiction between
documents — ask rather than guessing.
