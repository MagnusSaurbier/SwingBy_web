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

**Push your branch as soon as you have anything at all**, then keep pushing after every meaningful
step. Do not save it up for one commit at the end.

```bash
git checkout -b task/<your-task-slug>
git commit --allow-empty -m "start <task>"
git push -u origin task/<your-task-slug>     # do this in your first few minutes
```

A previous run of three agents was killed by a shared usage limit roughly seven minutes in. All
three had done real work. Because none had pushed and all had cloned outside `/workspace`, nearly
all of it was lost. Pushing early costs you nothing and makes an interruption survivable — your
work is not "done" when it is correct, it is done when it is *pushed*.

Then read, in this order: [README.md](README.md), [PROJECT.md](PROJECT.md),
[INTERFACES.md](INTERFACES.md), and finally your own task document in [`tasks/`](tasks/).

Those documents are authoritative. Your task document ends with **Deliverables**, **Definition of
done**, and **How to verify** — all three are the spec, not suggestions.

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
