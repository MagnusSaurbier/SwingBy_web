# T-14 LAUNCHPAD — working log

## 2026-08-13 — backfill: everything decided/found before this log existed

Read README.md, PROJECT.md, INTERFACES.md, DESIGN.md, tasks/T-14-LAUNCHPAD.md in that order,
plus tasks/T-01, T-03, T-08, T-09, T-10, T-12, T-13 for cross-checks below. Environment note:
node v22.22.2 / npm 10.9.7 are what's actually installed (docs say Node 26/npm 11 — ignoring
that, targeting `>=22`, not adding pnpm). Orchestrator forbids all git commands — the
orchestrator commits/pushes for me. No Vercel/Cloudflare/Neon/live-domain access in this
container.

**Conflict found and resolved: who owns `packages/web/index.html` / `src/main.ts`.**
tasks/T-08-BRIDGE.md's own "Owned files" section lists both as T-08 deliverables ("app entry +
router"). But INTERFACES.md's file-ownership table — the actually-frozen contract — only gives
T-08 `packages/web/src/ui/**`; it does not mention index.html or main.ts at all. My own
orchestrator brief explicitly told me to create `packages/web`'s package.json, vite config,
index.html and a minimal src/main.ts placeholder "that other agents' modules will be wired into
later." Resolution: treat this the same way the pre-existing root `package.json` already did
(it shipped with a `"//": "SEED SCAFFOLD... Owned by T-14... T-08 refines it"` comment) — I
create minimal placeholders so `npm run dev/build -w @swingby/web` are real and green *today*,
clearly commented as scaffolding T-08 replaces wholesale, not a claim of ongoing ownership. Did
NOT touch `packages/web/src/storage/**` (T-10's, already had a file there when I looked —
`level-id-fallback.ts`, a documented temporary shim for T-03's not-yet-landed `levelId`).

**tsconfig lib decision.** Root tsconfig had no explicit `lib`, so default lib for `target:
ES2022` is ES2022-only — no DOM types. That's fine for packages/core but breaks typechecking
anything in packages/web that touches `document`/`HTMLCanvasElement`/etc. Considered per-package
tsconfigs (one with DOM, one without, for stricter enforcement that core never touches browser
globals) but the task doc's deliverable table lists tsconfig.json as a single root artifact, and
`npm run typecheck` is specified as one command over "every workspace" — so went with **one
shared root tsconfig**, added `"lib": ["ES2022","DOM","DOM.Iterable"]`. Tradeoff, recorded
honestly: this means an accidental `window`/`document` reference inside packages/core would no
longer be caught by typecheck (only at actual node runtime, e.g. during `vitest run` for core,
which is a real but weaker backstop). Also added `@types/node` (as a root devDependency) for
api/** and vite.config.ts.

**Confirmed via `npm run typecheck` (exit 0, no errors) before touching anything**, so this is a
true baseline, not an assumption.

**Vitest "no test files" behavior confirmed empirically**, since this matters for CI design:
ran `npm test -w @swingby/core -- parity` and root `npm test` on the pristine repo (no test
files exist anywhere yet, since T-01/T-02/T-03 haven't landed tests). Both exit 1 with
"No test files found, exiting with code 1". This is vitest's real default behavior, not a config
bug — confirms a naive `npm test -w @swingby/core -- parity` CI step would be RED for every PR
until T-01 lands, and likewise for solvability until T-03 lands.

**CI design decision because of the above:** wiring the parity/solvability steps as unconditional
hard-fail steps would turn CI red for *every* unrelated PR (e.g. T-08's) until T-01/T-03 land,
which contradicts "13 tasks can start in parallel" from README.md. Chose instead: each step
checks whether the relevant test directory contains any `*.test.ts` file; if not, it prints a
GitHub Actions `::warning::` and passes (soft, informational); if yes, it runs
`npm test -w @swingby/core -- parity` (or `-- solvability`) for real as an unconditional hard
gate — no special-casing once the files exist. This satisfies "wire them by script name so they
light up when those tasks land" literally, and once T-01/T-03 land, a broken parity/solvability
test WILL redden CI exactly per the task doc's DoD, with no further action from me. Documenting
here because it's the one place I deviated from a maximally-literal reading of the task doc
("CI fails on a deliberately broken parity test") — I can't prove that specific scenario right
now because physics.ts having a test suite isn't my file to create or corrupt; T-01 owns
`packages/core/test/parity/**` and I won't write into it, even temporarily, to fake a demo.
Recording this as a **known incomplete verification**, not silently working around it — will
mark the corresponding DoD box "not-done, blocked on T-01/T-03 landing" in results.md rather than
claiming it verified.

**Bundle/lib size baseline, measured, not guessed:** built `@swingby/web` with only the
placeholder main.ts (imports `TPS`, `MAX_WORLD_BOUNDS_X/Y` from `@swingby/core` to prove
cross-workspace resolution, not an empty stub) → `dist/assets/index-*.js` = 1.53 kB raw / 0.89 kB
gzip. Confirms workspace resolution + esbuild bundling works end to end.

**Confirmed SPA fallback works in dev out of the box**: vite's default `appType: "spa"` serves
index.html for unmatched paths with no extra config. `curl localhost:5173/play/builtin-07` → 200
on a cold request (verified live, dev server started via `npm run dev -w @swingby/web`, curled,
killed). This is the *dev* fallback; production fallback is a `vercel.json` rewrite
(`"/(.*)" -> "/index.html"`) which is the standard documented Vercel SPA idiom — static files
still win over the rewrite because Vercel checks the filesystem before applying rewrites, so this
does not break immutable-cached hashed assets under `/assets/*`.

**Prettier baseline surprised me**: `prettier --check .` on the pristine repo flags 23
pre-existing files — every root/tasks doc (README, PROJECT, INTERFACES, DESIGN, AGENTS,
tasks/*.md) *and* the FROZEN `packages/core/src/types.ts` / `constants.ts`. I can't fix any of
those (not mine to touch; two are literally frozen). So the seeded `"lint": "prettier --check ."`
over `.` cannot ever pass as shipped. Plan (not yet executed as of this log entry): add a
`.prettierignore` scoping lint to the code that's actually under active workspace development —
excluding reference/, root narrative docs, tasks/, results/, and the two frozen core files by
name — rather than trying to reformat things I don't own. Will verify `npm run lint` goes green
after that and report the concrete before/after.

**Dependency choices for `api/package.json`** (mine to own per INTERFACES.md, even though
`api/**` routes are T-12's): added `@neondatabase/serverless` (dependency) because
DESIGN.md §8 and tasks/T-12-LEDGER.md both specifically call for Neon's *HTTP driver* to avoid
exhausting connections from serverless functions — that's this package's whole reason to exist,
not a guess. Added `@vercel/node` (devDependency, types only) for `VercelRequest`/
`VercelResponse`. Left a comment in the file inviting T-12 to request changes rather than fork
around not owning the file.

## Next steps (as of this entry)
- Write `infra/size-check.mjs`, wire it to `npm run size`, prove pass + fail with real numbers.
- Write `vercel.json` (SPA rewrite + cache headers + buildCommand/outputDirectory for the
  monorepo layout — Root Directory must stay repo root, not packages/web, so `/api/**` still
  deploys alongside the static build).
- Write `.github/workflows/ci.yml` per the design above.
- Write `.prettierignore`, verify `npm run lint`.
- Write `infra/DEPLOY.md` runbook (Cloudflare grey-cloud step gets full prominence, per task doc
  emphasis that this is the step that reliably goes wrong).
- Write `results/T-14-LAUNCHPAD.md` with every measured number and an explicit BLOCKED —
  host-only section (Vercel project/domain, Cloudflare DNS record, Neon provisioning, Lighthouse
  against a live URL, the personal-site link PR — none of which are reachable from this
  container).
