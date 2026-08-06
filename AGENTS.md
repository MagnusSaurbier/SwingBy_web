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
