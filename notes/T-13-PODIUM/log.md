# T-13 PODIUM — working log

Append-only. See notes/README.md for convention.

## 2026-08-15T11:10Z — plan, before any code

### Read, in order
README.md, PROJECT.md, INTERFACES.md (full — `api` contract + `web/net` section), tasks/T-13-PODIUM.md,
packages/core/src/types.ts (full). Then notes/T-12-LEDGER/log.md (full — wire formats, rate limiter real
behaviour, validation rules), notes/T-08-BRIDGE/log.md (full — UI conventions, tokens, no-framework
decision, screenshot/keyboard methodology), notes/T-10-VAULT/log.md (full — storage semantics, the
optimistic-vs-persist-first split, the exact `Storage` interface surface). Then the ACTUAL T-12 route
implementations (not just INTERFACES.md's summary): `api/score.ts`, `api/leaderboard.ts`,
`api/levels/index.ts`, `api/levels/[id].ts`, `api/_ratelimit.ts`, `api/_validate.ts`, `api/_db.ts`,
`infra/schema.sql`. Then `packages/web/src/storage/index.ts` (T-10, full), `packages/web/src/hud/complete.ts`
(T-09's completion panel — full, since I need to match its `RankSlot`/`setRank` slot exactly), and
`packages/web/src/ui/{dom,screen,app}.ts` + `screens/{play,levelSelect,sharedPlaceholder,editorPlaceholder}.ts`
+ `styles/tokens.css` + `icons.ts` (to match conventions for the `ui/leaderboard/**` subtree without
touching anything else under `ui/`).

### Key findings that shape the design

1. **No idempotency key exists in the frozen wire contract.** INTERFACES.md's `Api.submitScore` and
   T-12's actual `POST /api/score` body are both exactly `{ levelId, metric, timeMs, boostMs, name, tape }`
   — no request id, no nonce, nothing for the server to dedupe on. `infra/schema.sql`'s `score` table has
   no unique constraint either (checked directly — only CHECK constraints on ranges). T-13's own task doc
   DoD says "No duplicate submissions on retry — idempotency key agreed with T-12", but T-12 is DONE and
   its interface is frozen; I cannot add a field to a route six sessions and 114 tests already shipped
   against, and INTERFACES.md's own rule is "never change a shared signature unilaterally — update the
   doc and notify consumers" for a reason this far downstream. Decision: implement the best available
   **client-side** compensating control instead of a real server-side idempotency key, and say so plainly
   in results.md rather than claiming something the contract doesn't support:
   - The queue enqueues a submission exactly once per `session.onComplete` firing (caller's job, not
     mine — I only guarantee the queue itself never re-adds a settled item).
   - Drains are **strictly sequential and single-flight** (a module-level "draining" guard) — two
     concurrent `drain()` calls (e.g. one from a reconnect listener, one from a page-load kick) can never
     both be mid-flight for the same queued item.
   - An item is removed from the persisted queue **synchronously, immediately** on any terminal outcome
     (`accepted: true` OR a permanent rejection like invalid-tape/verification-failed) — so replaying
     `drain()` after a successful drain finds an empty queue and sends zero further requests. This is the
     property the task's "prove idempotency by replaying a drain" step can actually verify, and it's what
     I'll measure and report as a number (0 additional requests).
   - What this does NOT cover, stated honestly: if the server processes a POST and its response is lost
     in flight (TCP RST after commit, tab killed mid-response), the client cannot distinguish that from
     "never received", and a retry will genuinely create a second row server-side. This is a real gap
     inherent to the frozen contract having no idempotency token — flagging as an open item for a future
     interface revision (`clientSubmissionId` field), not silently papering over it.

2. **`Api.submitScore`'s frozen return type (`{ accepted: boolean; rank?: number }`) cannot carry
   enough signal for backoff decisions** (rate-limited vs. network failure vs. permanently rejected all
   collapse to `accepted: false`). Resolution: split the HTTP mechanics into an internal (non-frozen)
   helper `net/http.ts` (`requestJson`) that returns a richer discriminated-union outcome (ok / http-error
   / rate-limited-with-retryAfterMs / timeout / network-error / invalid-json), used by BOTH
   `createApi()`'s `submitScore` (narrowed down to the frozen shape at the boundary) and `queue.ts`
   (which needs the rich signal to choose backoff vs. drop). `net/**` is my whole owned subtree per
   INTERFACES.md's file-ownership table, so adding helper modules beside the two named deliverable files
   is in scope — only the two frozen signatures (`Api`, `createApi`) must match exactly, which they will.

3. **T-10 VAULT's frozen `Storage` interface has no generic key/value slot** — only
   `getSettings/setSettings/getBest/recordBest/listCustomLevels/saveCustomLevel/deleteCustomLevel/export/import`.
   Rule 6 says "back the queue with T-10 VAULT's storage" but there is literally no method on the frozen
   interface that could hold an arbitrary queue array, and `storage/index.ts` is T-10's owned file, not
   mine to extend. Decision: implement the queue's persistence directly against the SAME substrate VAULT
   itself uses — `globalThis.localStorage`, with the identical graceful-degradation shape VAULT uses
   (probe-writable-or-fall-back-to-an-in-memory-Map, never throw), under the same `swingby:` key
   namespace (`swingby:score_queue`). This is "backed by T-10 VAULT's storage" in the sense that matters
   (same origin, same fallback semantics, same survive-a-reload property, same namespace convention) even
   though it's a sibling implementation rather than a literal call into `Storage`. Flagging in results.md
   as the exact `ui`/`storage`-adjacent wiring gap: if a shared substrate is wanted later, T-10's
   interface would need a `getRaw(key)/setRaw(key, value)` escape hatch added — that's a request for the
   orchestrator, not something I can do unilaterally by editing `storage/index.ts`.

4. **T-09's completion panel already has the rank slot wired and waiting**: `hud/complete.ts` exports
   `RankSlot = { status: "unavailable"|"loading"|"loaded"|"error"; rank?: number }` and
   `CompletePanelHandle.setRank(slot)`. I will not import from `hud/**` (DoD explicitly forbids importing
   `game/loop` — `hud/` isn't literally banned, but it's not my file and T-09 says "coordinate, don't
   rewrite"), but I WILL shape my queue's public event/result surface so mapping it onto `RankSlot` at the
   call site is a one-line translation, and I'll spell out that exact translation in results.md as the
   wiring the orchestrator needs to paste into whatever module ends up constructing `GameSession` +
   `mountGauge` (no such integration point exists yet in the tree — `ui/screens/play.ts` is deliberately a
   chrome-only placeholder per T-08's own log, and nothing else calls `mountGauge`/`createSession`
   together yet. That integration is out of scope for every task's file-ownership row I can find, so it's
   a genuine gap for the orchestrator, not something I'm failing to notice.)

5. **T-12's real limits, confirmed from source, not just INTERFACES.md's summary**: `SCORE_RATE_LIMIT =
   { limit: 8, windowMs: 60_000 }`, `LEVEL_RATE_LIMIT = { limit: 5, windowMs: 60_000 }`, sliding window
   (`_ratelimit.ts`'s `createRateLimiter`), 429 response carries a `Retry-After` header in whole seconds
   (`Math.ceil(retryAfterMs/1000)`). My mock server will reproduce this exact algorithm (reimplemented
   locally in `test/mock-api.ts`, not imported cross-package from `api/` — `api/` isn't a dependency of
   `@swingby/web` and I'd rather not couple test infra to another task's private module path) so the
   rate-limit test is measuring against realistic behaviour, not an invented one.

6. **Timeout budget**: T-12 measured (its own log) verifyReplay-through-the-real-route at 11–24 ms
   typical / up to 160 ms worst case (10-minute tape cap). Network RTT dominates over that by orders of
   magnitude for any real deployment. Task doc says "3–5 s". Choosing **4000 ms** — comfortably inside the
   requested range, leaves ~3.84 s of margin over the worst-case 160 ms server processing time for
   TLS/TCP handshake + queueing, while still failing fast enough that a hung request never reads as "the
   game is broken." Will prove this against both a connection-refused mock (fast, real "offline") and a
   route that accepts the connection but never writes a response (proves the abort actually fires at the
   client, not just that the network was down).

### Design, file by file

- `packages/web/src/net/http.ts` — `requestJson<T>()`: fetch wrapped in `AbortController`, 4000 ms
  default timeout, returns a `HttpOutcome<T>` union, never throws. `REQUEST_TIMEOUT_MS` exported as a
  named constant so it's a checkable number, not a magic literal.
- `packages/web/src/net/validate.ts` — response-shape guards: `parseLeaderboardEntries` (drops malformed
  rows, preserves server order — task doc: "mirror the server's ordering, do not re-sort"),
  `looksLikeLevelPayload` (structural check before trusting a fetched `Level`, reuses `@swingby/core`'s
  `validate()` for the gameplay-rules layer on top of the shape layer), `sanitizeClientName` (client-side
  mirror of `api/_validate.ts`'s cap, defense in depth — not load-bearing since the server re-sanitizes,
  but avoids sending something the server will just truncate anyway).
- `packages/web/src/net/index.ts` — deliverable 1. `LeaderboardEntry`, `Api`, `createApi(baseUrl)` EXACTLY
  as frozen. Every method catches its own failure internally (never rejects for
  `leaderboard`/`submitScore` — degrade to `[]` / `{accepted:false}`; `shareLevel`/`fetchLevel` reject
  because their frozen return types have no room for a failure value, so callers MUST catch — documenting
  this exactly as the contract callers get).
- `packages/web/src/net/queue.ts` — deliverable 2. `createSubmissionQueue({ baseUrl, now? })`. `submit()`
  enqueues synchronously (never awaited by the caller) and kicks an async drain; `drain()` is
  single-flight, sequential, respects per-item `nextAttemptAt` backoff, stops issuing new requests the
  moment it sees a rate-limited response (reschedules the rest using the server's `Retry-After` rather
  than continuing to hammer); bounded growth via `MAX_QUEUE_SIZE` (drop-oldest) and `MAX_ATTEMPTS` /
  `MAX_AGE_MS` (drop-and-log) so a permanently-unreachable API can't grow the queue forever.
- `packages/web/src/ui/leaderboard/**` — deliverable 3. Presentational only, no fetch calls of its own
  (takes already-fetched data — keeps it trivially testable and keeps the "never trust the server shape"
  boundary in `net/validate.ts`, one place). `panel.ts` (ranked list + verified marker + "you" row +
  offline note), `worldBest.ts` (one-line level-select adornment), `leaderboard.css` (self-contained,
  imported only by this subtree so it costs 0 bytes in the current bundle until something wires it in).
  All text nodes via `document.createTextNode`/`.textContent` — never `innerHTML` on server-sourced
  strings — this is what makes the `<img src=x onerror=...>` name case inert by construction, not by
  discipline I have to remember per call site.
- `packages/web/test/mock-api.ts` — deliverable 4. A REAL local `http.createServer` (not a fetch mock/
  monkeypatch), bound to `127.0.0.1:0` (ephemeral port), implementing the six routes' observable contract
  (status codes, bodies, `Retry-After`, the 8/60s and 5/60s sliding-window limits) with test-controllable
  hooks for canned responses, artificial latency, and "never respond" (hung-server proof). Chosen over a
  fetch-monkeypatch because (a) it exercises the REAL network stack — real timeouts, real concurrent
  connections, real `AbortController` behaviour — the same reasoning T-12 preferred a real local Postgres
  over a mock; (b) `createApi(baseUrl)`'s signature is frozen to exactly one parameter, so there is no
  slot to inject a fake `fetch` into `createApi` itself even if I wanted to — a real server sidesteps that
  entirely; (c) doubles as a genuine `npm run dev` companion per the task doc's own "Local mock server for
  development" framing.
- Tests: `packages/web/test/net-http.test.ts`, `net-index.test.ts`, `net-queue.test.ts`,
  `net-validate.test.ts`, `ui-leaderboard.test.ts` (pure logic / DOM-construction, no headless browser
  needed for these — same split T-08 used: pure logic under plain vitest, visual/keyboard proof under
  real headless Chromium separately for screenshots).

### Screenshot plan (deliverable 5)

Nothing under `ui/leaderboard/**` is wired into the running app yet (no task owns the integration point
— see finding 4). To get real, non-fabricated screenshots I'll bundle `ui/leaderboard/**` standalone with
esbuild (present in node_modules, vite's own dependency, zero new package needed) into a tiny static HTML
harness in the scratchpad dir, serve it with a plain `http.createServer` (or `http-server`/`serve`,
globally available), and drive real headless Chromium
(`/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `playwright` package resolves
from `/opt/node22/lib/node_modules`) against it, feeding it real data from a running `mock-api.ts`
instance (populated + offline states) rather than hand-typed fixture HTML. This is a real render of my
real shipped code, just not through the full app shell (which nobody has wired up yet) — stating this
plainly in results.md rather than implying it's integrated.

### Next step

Write `net/http.ts` first (no dependencies on anything else I'm writing), then `validate.ts`, then
`index.ts`, then `queue.ts`, then `mock-api.ts`, then tests, then the `ui/leaderboard` subtree, then the
standalone screenshot harness, then results.md. Nothing written to disk yet except this log entry.

## 2026-08-15T11:35Z — resumed after a usage-limit interruption; core net/** modules written

Coordinator's resume message confirmed: log survived and pushed, `packages/web/src/net/` was empty
(nothing lost — I had only written the log entry before the interruption, exactly as the log said). Full
repo suite at resume: typecheck clean, 646 passed, 1 skipped, 0 failed. Proceeded exactly per the plan
above.

**Wrote, in order:** `net/http.ts` (`requestJson`, `HttpOutcome`, `isRetryable`, `REQUEST_TIMEOUT_MS` =
4000, `DEFAULT_RATE_LIMIT_BACKOFF_MS` = 60000), `net/validate.ts` (response-shape guards — hit and fixed
a real self-inflicted bug here, see below), `net/index.ts` (deliverable 1 — `Api`/`createApi` exactly as
frozen, plus `buildScoreRequestBody`/`postScore` exported for `queue.ts` to share), `net/persist.ts`
(VAULT-substrate-alike backing store for the queue — see finding 3), `net/queue.ts` (deliverable 2).

**Real bug caught while writing `validate.ts`, not by a test — worth recording because it's a
`no-git`-adjacent lesson:** my first draft of the control-character stripping regex
(`/[ --]/g`, mirroring `api/_validate.ts`'s own `CONTROL_CHARS`) got mangled by
the file-write path — the ` ` escape sequences were interpreted eagerly and the literal NUL/DEL/C1
bytes ended up embedded directly in the source file's text instead of surviving as the two-character
`\`+`u` escape sequence TypeScript itself would later re-interpret. Caught it by piping the file through
`cat -A` right after writing (a habit worth keeping for any file with an intentional control-character
literal) and saw raw `^@`/`^_`/`M-B` control-byte markers sitting in what should have been an escape
sequence. Fixed by rewriting the check as `stripControlChars()` — a plain loop over `codePointAt` against
numeric ranges (`0x00-0x1F`, `0x7F-0x9F`), which needs no control-byte literals or escape sequences in
the source at all. Re-verified with `cat -A | grep` for stray `^@`/`M-`/`^?` markers — clean. Noting this
so a future session doesn't lose time to the same file-write escaping surprise.

**Typecheck after all five files**: `npx tsc --noEmit -p tsconfig.json` — zero errors under `net/**`. One
pre-existing error remains repo-wide, in `packages/web/src/editor/editor.ts:891` (a `CanvasGradient`
vs. `string` `strokeStyle` mismatch) — confirmed this is T-11 DRAFT's file, actively being edited per the
coordinator's own note ("T-11 DRAFT is editing `editor/` right now"), not something I touched or need to
chase.

**Design note not yet in the plan entry above, decided while writing `queue.ts`'s `drain()`:** the
"back off rather than hammer" property is implemented as an early-stop within a single `drain()` pass,
not just per-item backoff — the FIRST rate-limited (429) response in a pass immediately stops issuing any
further requests for the rest of that pass (remaining eligible items are rescheduled using the server's
own `Retry-After`, never sent). This is what makes "requests attempted vs. sent" a meaningful, provable
number rather than "eventually all get rate-limited" — with T-12's real 8/60s limit, a burst of e.g. 12
eligible items should show `attempted: 12, sent: 9` (8 succeeding + the 9th tripping the 429), with the
remaining 3 rescheduled and zero requests issued for them this pass.

**Next step**: write `packages/web/test/mock-api.ts` (a real local `http.createServer`, not a fetch
monkeypatch — see plan's reasoning), then the test files (`net-http`, `net-validate`, `net-index`,
`net-queue`), then run them.
