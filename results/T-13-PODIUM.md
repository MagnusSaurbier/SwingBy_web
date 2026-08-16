# T-13 PODIUM — Results

Leaderboard and sharing client. Area `packages/web/src/net/**` + `packages/web/src/ui/leaderboard/**`
(exception to T-08 BRIDGE's `ui/**` ownership, coordinated per the task doc) + `packages/web/test/mock-api.ts`
+ `packages/web/test/net*.test.ts`. Full working log: [`notes/T-13-PODIUM/log.md`](../notes/T-13-PODIUM/log.md).

## The rule that matters most

**The game stays fully playable with the API unreachable, and nothing ever blocks a level start or
completion on a network call.** Proven, not asserted — see "Offline behaviour" below for the real
numbers, measured against a genuinely closed connection (not a slowed one).

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `createApi` + `Api` interface, timeouts + retry | `packages/web/src/net/index.ts` | Done. Exact frozen signature. Supporting modules `net/http.ts` (fetch-with-timeout core, shared with the queue), `net/validate.ts` (response-shape guards). |
| 2 | Offline submission queue, backed by T-10 VAULT's storage | `packages/web/src/net/queue.ts` (+ `net/persist.ts`) | Done, with one honest, documented deviation — see "Storage substrate" below. |
| 3 | Leaderboard UI: completion panel + level select | `packages/web/src/ui/leaderboard/panel.ts`, `worldBest.ts`, `leaderboard.css` | Done as a presentational, unwired component — see "Wiring the orchestrator needs" below. Not yet mounted by any screen (no task's ownership row covers that integration point). |
| 4 | Local mock server for dev + tests | `packages/web/test/mock-api.ts` | Done. Real `node:http` server, not a `fetch` mock. |
| 5 | Screenshots: populated leaderboard + offline state | `notes/T-13-PODIUM/screenshots/*.png` | Done, 4 files (2 scenarios x 2 widths). |

Supporting files not separately named as deliverables but part of my owned subtree:
`packages/web/src/net/http.ts`, `packages/web/src/net/validate.ts`, `packages/web/src/net/persist.ts`,
`packages/web/src/ui/leaderboard/__tests__/worldBest.test.ts`, `packages/web/test/net-http.test.ts`,
`packages/web/test/net-validate.test.ts`, `packages/web/test/net-index.test.ts`,
`packages/web/test/net-queue.test.ts`.

## Storage substrate — a deviation from the literal task wording, explained

Deliverable 2 says "backed by T-10 VAULT's storage." The FROZEN `Storage` interface
(INTERFACES.md#webstorageindexts--t-10-vault) exposes exactly `getSettings/setSettings/getBest/
recordBest/listCustomLevels/saveCustomLevel/deleteCustomLevel/export/import` — no generic key/value
slot a queue array could live in, and `storage/index.ts` is T-10's owned file. `net/persist.ts`
reimplements the identical graceful-degradation contract T-10's own module uses internally
(probe-writable `localStorage`, fall back to an in-memory `Map`, never throw), under the same
`swingby:` key namespace (`swingby:score_queue`) — same survive-a-reload property, same failure
mode, sibling implementation rather than a call through `Storage`. **Request for the orchestrator**:
if a literal shared substrate matters more than the equivalent behaviour, T-10's `Storage` interface
would need a `getRaw(key)/setRaw(key, value)` escape hatch added — a change to a file I don't own,
named here rather than done unilaterally.

## Definition of done

| Item | Status | Reason |
|---|---|---|
| Every method degrades gracefully with the API genuinely unreachable (tested down, not slow) | ✅ | `net-index.test.ts` closes the mock server before requesting (real ECONNREFUSED); `leaderboard()` -> `[]`, `submitScore()` -> `{accepted:false}`, both resolve, never reject. `shareLevel`/`fetchLevel` reject (their frozen return types have no failure slot) — documented as the contract callers get. |
| A completed level submits once and shows a rank | ⚠️ Partial | The queue's `succeeded` event carries `rank` (proven in `net-queue.test.ts` and the mock's real-leaderboard round trip). Nothing wires it to T-09's `complete.setRank()` yet — no task's file-ownership row covers constructing a `GameSession` and calling `mountGauge` together. See "Wiring the orchestrator needs." |
| No duplicate submissions on retry — idempotency key agreed with T-12 | ⚠️ Partial, honestly | **No idempotency key exists in the frozen wire contract** — `POST /api/score`'s body (INTERFACES.md, `api/score.ts`) is exactly `{levelId, metric, timeMs, boostMs, name, tape}`, and `infra/schema.sql`'s `score` table has no unique constraint. T-12 is done; I cannot add a field to its frozen, already-shipped route unilaterally. What IS implemented and proven: single-flight drains + synchronous dequeue-on-terminal-outcome, so a replayed `drain()` after success sends **0** further requests (see "Idempotency" below). The one real gap, stated plainly: if a response is lost in flight after the server already committed the row, a retry creates a second one — inherent to the contract, not hidden. |
| Queued submissions retry on next load | ✅ | `net-queue.test.ts` "offline -> queue -> reconnect -> drain": a fresh `createSubmissionQueue()` against the same backing store (simulating a reload) sees the persisted item and drains it. |
| Share produces a working URL; opening it loads the level | ✅ (client half) | `shareLevel` -> `fetchLevel` round trip proven end-to-end against the mock in `net-index.test.ts`. "Opening the URL in a browser" isn't proven because `/l/:shareId` is currently T-08's placeholder screen (not yet calling `fetchLevel`) — see wiring section. |
| Usernames containing `<script>` render as literal text | ✅ | Proven twice: `net-validate.test.ts` asserts the raw string survives unmodified through `parseLeaderboardEntries`, and the screenshot (`leaderboard-populated-*.png`) shows `<img src=x onerror=alert(1)>` rendered as visible text in a real browser, no image element, no alert fired. |
| Requests time out (3-5s) and recover; no permanently pending UI | ✅ | `REQUEST_TIMEOUT_MS = 4000`. Proven against the REAL production constant (not a shortened test-only value) in `net-index.test.ts`: a hung mock route still resolves `submitScore()` to `{accepted:false}` at ~4000-4500ms elapsed. |
| Nothing beyond the documented fields is sent — no fingerprinting, no analytics | ✅ | `net-index.test.ts` "payload discipline" asserts the exact key set `{boostMs, levelId, metric, name, tape, timeMs}` on the real HTTP request body the mock received, and the exact `{name, author, data}` for share. |
| Verified entries display their marker and sort above unverified | ✅ | Marker: `sb-lb-verified` badge, screenshot-confirmed. Sort: never re-sorted client-side — `parseLeaderboardEntries` preserves server order exactly (test: "passes through valid entries, preserving server order"), matching the task doc's "mirror the server's ordering." |
| No import from `core/physics`, `game/loop`, or `render/` | ✅ | `grep -rn "core/physics\|game/loop" packages/web/src/net packages/web/src/ui/leaderboard` — zero hits. `render` appears once, only inside a doc comment stating the rule itself (not an import) — checked directly. |
| Global checklist (PROJECT.md §7) | ✅ | Typecheck clean under every file I touched; full repo suite green (763 passed, 1 skipped, 0 failed); no file outside my ownership rows modified (checked below); zero new runtime dependencies; interfaces consumed unchanged; every number below is a number. |

### File-ownership check

```
$ git status --porcelain | grep -v '^??' | grep -vE 'packages/web/(src/net|src/ui/leaderboard|test/(mock-api|net-.*test))|notes/T-13-PODIUM|results/T-13-PODIUM'
```
(empty — nothing outside my owned paths was modified; only new, untracked files under my own
directories plus this results file and the log.)

## Offline behaviour — the headline result, as numbers

Test: `packages/web/test/net-queue.test.ts`, "offline -> queue -> reconnect -> drain."

1. A mock server is started, then **closed** (real `ECONNREFUSED`, not a slow response) — `baseUrl`
   now points at nothing.
2. `queue.submit(payload)` is called against that dead `baseUrl`. **Measured: returns in <20ms**
   (never blocks). `queue.size()` is `1` immediately, and the record is confirmed present in the
   backing store synchronously — this is the "even if the process died right here, the score is not
   lost" property.
3. A fresh `createSubmissionQueue()` is created against a NEW, live mock server but the SAME backing
   store (simulating a reload after regaining signal). `reconnected.size()` is `1` — the queued item
   survived.
4. `reconnected.drain()` is called: **attempted: 1, sent: 1, succeeded: 1, remaining: 0**. The score
   genuinely landed on the mock's server-side leaderboard (confirmed via the mock's own request log).

**Queued: 1. Drained: 1. Succeeded: 1.**

### Idempotency proof

Test: `net-queue.test.ts`, "idempotency."

- After the drain above succeeds, `queue.drain()` is called again (replay). **Result: `attempted: 0,
  sent: 0`. Zero additional HTTP requests reach the server** (`handle.requests.length` unchanged,
  checked directly against the mock's real request log, not just the summary object). A third replay:
  same result.
- Concurrency proof: two `drain()` calls are started with the first's HTTP response artificially
  gated open, so a second `drain()` call genuinely overlaps the first's in-flight request. The second
  call's single-flight guard reports `attempted: 0, sent: 0`, and exactly **one** POST to `/api/score`
  ever reaches the server (checked on the mock's request log).
- Documented limitation (see DoD table above): this is a **client-side** guarantee. There is no
  server-side idempotency key in the frozen wire contract, so a response genuinely lost in flight
  after the server commits is not covered — flagged as an open item, not papered over.

## Timeout and backoff — as numbers

- **`REQUEST_TIMEOUT_MS = 4000`** (`net/http.ts`). Justification against T-12 LEDGER's own measured
  numbers (notes/T-12-LEDGER/log.md): server-side verification runs **11-24ms typical, up to ~160ms**
  at the 600-second tape cap. 4000ms leaves **~3.84s of margin** over the worst case for real network
  RTT + TLS handshake, while still failing fast enough that a hung request never reads as "the game is
  broken." Proven end-to-end (not just unit-level) in `net-index.test.ts`: a mock route configured to
  never respond still resolves `api.submitScore(...)` to `{accepted:false}` in **3900-4500ms measured
  elapsed time**, using the real, unmodified `REQUEST_TIMEOUT_MS` constant (`net-http.test.ts` also
  proves the mechanism itself with a short test-only timeout, for speed).
- **Backoff schedule** (`net/queue.ts`, `BACKOFF_SCHEDULE_MS`): **2s, 5s, 15s, 60s, 300s** (clamped at
  the last entry for attempt 5+). Reaches and holds a full 60s window by the 4th attempt — matching
  T-12's real sliding window (`SCORE_RATE_LIMIT.windowMs` / `LEVEL_RATE_LIMIT.windowMs`, both
  60,000ms) — then backs off further to 5 minutes rather than ever converging back down to hammering.
- A `429` response overrides the schedule entirely and uses the server's own `Retry-After` header
  (parsed as whole seconds -> ms, matching what `api/score.ts`/`api/levels/index.ts` actually send:
  `Math.ceil(retryAfterMs/1000)`). Falls back to `DEFAULT_RATE_LIMIT_BACKOFF_MS = 60000` if the header
  is missing or malformed — proven in `net-http.test.ts`.
- **Bounded growth**: `MAX_QUEUE_SIZE = 20` (drop-oldest on overflow, proven: submitting 25 items
  leaves exactly the most recent 20, with 5 `dropped`/`queue-full` events for the oldest 5).
  `MAX_ATTEMPTS = 8` (a persistently-failing item is dropped after 8 tries, proven with a fake clock
  fast-forwarded past each backoff step — 500 responses every time, confirmed dropped with
  `max-attempts-exceeded`, never exceeding 8 real HTTP attempts on the wire). `MAX_AGE_MS = 7 days`
  (an item seeded with an old `createdAt` is pruned on the very next `drain()`, confirmed zero HTTP
  attempts made for it — pruned before ever being sent).

## Rate-limit behaviour — requests attempted vs. sent

Test: `net-queue.test.ts`, "rate limiting," driven against a mock configured with **T-12's real,
measured limit: 8 requests / 60s sliding window** (`api/_ratelimit.ts`'s `SCORE_RATE_LIMIT`,
confirmed by reading the source, not just INTERFACES.md's summary).

12 items are made eligible in a single queue (simulating a backlog built up while offline). One
`drain()` pass:

| Metric | Value |
|---|---|
| Attempted (eligible this pass) | 12 |
| **Sent (actual HTTP requests issued)** | **9** |
| Succeeded | 8 |
| Rate-limited (429 received) | 1 |
| Remaining, rescheduled without a request | **3** |

**The client backs off rather than hammers**: the 9th request trips the real limit and receives a
`429`; the drain loop stops issuing new requests immediately — the remaining 3 items are rescheduled
using the server's own `Retry-After` and never touch the network this pass. A follow-up bug (see log,
2026-08-15T11:35Z entry) meant the first implementation left those 3 "still eligible right now,"
which would have caused an immediate second burst on the next drain — caught by this exact test,
fixed, confirmed with `item.nextAttemptAt > now` for all 4 rescheduled items.

## Hostile response handling

| Input | Handling | Where proven |
|---|---|---|
| Malformed JSON body (`{ this is not json`) | `requestJson` returns `{kind:"invalid-json"}`, never throws; `submitScore`/`leaderboard` degrade to `{accepted:false}` / `[]` | `net-http.test.ts`, `net-index.test.ts` |
| Wrong shape (`entries` not an array; `accepted` missing; `id` not a string) | Whole response treated as empty/failed at the top level | `net-validate.test.ts` "hostile / malformed top-level shape" |
| Wrong-typed row fields (`rank: "1"`, `verified: "true"`, `timeMs: "100"`) | That ONE row dropped, well-formed rows around it kept | `net-validate.test.ts` "per-row hostile / absurd values" |
| Absurd but finite values (`timeMs: 1e15`) | Accepted (a silly value is not a malformed one) — rendered via `formatMs`, no crash | `net-validate.test.ts` |
| Negative / non-finite values (`timeMs: -5`, `Infinity`) | Row dropped | `net-validate.test.ts` |
| `name` containing `<img src=x onerror=alert(1)>` | Preserved byte-for-byte through validation (not the safety boundary), rendered as **literal visible text** via `Element.append(string)` -> `Text` node, never `innerHTML` | `net-validate.test.ts` (string equality) AND the screenshot (real browser, no image element, no alert) |
| Share/level id containing path traversal or markup (`../etc/passwd`, `<script>...`) | Rejected by a strict `^[A-Za-z0-9_-]{1,40}$` pattern before ever being embedded in a URL | `net-validate.test.ts` "parseShareResponse — hostile" |
| Gameplay-invalid fetched level (no player object) | `fetchLevel` rejects — never handed to the game | `net-index.test.ts`, using `@swingby/core`'s own `validate()` |
| 10,000-object hostile level payload | `validate()` (defensive by construction, checked directly against its source) returns `ok:false`, never throws | `net-validate.test.ts` "hostile: absurd body does not throw" |
| Hung server (accepts connection, never responds) | Client aborts at `REQUEST_TIMEOUT_MS`, never sits pending | `net-http.test.ts`, `net-index.test.ts` |
| Genuinely unreachable (connection refused) | Fails in <1s, distinctly from the hung-server timeout case | `net-http.test.ts` "genuinely unreachable" |

## Gzipped size

Nothing under `net/**` or `ui/leaderboard/**` is imported by any currently-running screen (no task
owns the integration point yet — see "Wiring" below), so the shipped bundle is **unchanged**:

```
$ npm run build -w @swingby/web && npm run size
size-check: PASS — 15.74 KB gzip, 234.26 KB under budget
```

Standalone measurement (esbuild, minified, gzipped) of what these modules will cost once wired in:

| Bundle | Raw | Gzip |
|---|---|---|
| `net/index.ts` + `net/queue.ts` (pulls in `http.ts`, `validate.ts`, `persist.ts` transitively) | 9,492 B | **3,867 B (3.78 KB)** |
| `ui/leaderboard/panel.ts` + `worldBest.ts` (JS) | 4,316 B | 2,106 B |
| `ui/leaderboard/leaderboard.css` | 2,062 B | 780 B |
| **Combined (net + ui together)** | 13,556 B (JS) | **5,644 B (JS) + 780 B (CSS) = 6.27 KB** |

This is a **conservative overestimate**: the standalone bundle includes its own copy of `ui/dom.ts`,
`ui/icons.ts`, `ui/view-models.ts`'s `formatMs` (pulled in by `panel.ts`/`worldBest.ts`), all of
which are **already present** in the real app's shipped 15.74 KB (T-08's screens already import
them) — once actually wired into the real build, Vite/Rollup would not duplicate that shared code, so
the true marginal cost is smaller than 6.27 KB. Even at the conservative combined figure:
**15.74 + 6.27 = ~22.0 KB gzip against the 250 KB budget — 228 KB of headroom remaining.**

## Screenshots

`notes/T-13-PODIUM/screenshots/`:

| File | Scenario | Width |
|---|---|---|
| `leaderboard-populated-1280.png` | Loaded leaderboard, 5 rows, verified markers, "you" highlight, world-best line, XSS-name row | 1280px |
| `leaderboard-populated-360.png` | Same, responsive reflow (rank/name/verified row, time/boost row) | 360px |
| `leaderboard-offline-1280.png` | Offline note + personal best + "queued" confirmation, no leaderboard rows attempted | 1280px |
| `leaderboard-offline-360.png` | Same | 360px |

**Methodology** (full detail in the log, 2026-08-15T12:15Z entry): these are real renders of the
actual shipped `ui/leaderboard/**` source files, bundled standalone with esbuild and served to real
headless Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) against a real running
`mock-api.ts` instance — not hand-typed mockup HTML. The harness itself lives only in the session
scratchpad (not committed — it is not part of any deliverable, just the proof mechanism) since
nothing in the repo currently wires this component into a page of its own.

Two real bugs were found and fixed by actually looking at the rendered output (not just by the code
compiling): a CORS gap in `mock-api.ts` that would have equally blocked `npm run dev` from ever using
it cross-port (fixed by adding permissive CORS + an OPTIONS preflight handler — a genuine improvement
to deliverable 4, not just a harness workaround), and a pre-existing T-08 `icons.ts` quirk (the
`"info"` icon renders filled instead of stroked because it's missing from that module's own
`STROKE_ICONS` allowlist) which I sidestepped by not using that icon rather than editing a file I
don't own. Both are logged in full in `notes/T-13-PODIUM/log.md`.

## Fail-proof demonstration

Injected a one-line bug in `queue.ts`'s `drain()`: commented out `removeById(item.id)` on a
successful submission (marked `// INJECTED BUG`), so a succeeded item is never dequeued.

```
$ npx vitest run packages/web/test/net-queue.test.ts
 ❯ ... (9 tests | 3 failed)
   × offline -> queue -> reconnect -> drain ... expected 1 to be +0
   × idempotency ... a second drain() call ... waitUntil: timed out
   × rate limiting ... expected 12 to be 4
 Test Files  1 failed (1)
      Tests  3 failed | 6 passed (9)
```

Three independently-written tests caught the same root cause from three different angles. Reverted
by restoring the single `removeById(item.id)` line; re-ran: **9/9 passed**. `npx tsc --noEmit` clean
after revert.

## Test results

```
$ npx vitest run packages/web/test/net-http.test.ts packages/web/test/net-validate.test.ts \
    packages/web/test/net-index.test.ts packages/web/test/net-queue.test.ts \
    packages/web/src/ui/leaderboard/__tests__/worldBest.test.ts
```

| File | Tests |
|---|---|
| `net-http.test.ts` | 9 passed |
| `net-validate.test.ts` | 22 passed |
| `net-index.test.ts` | 15 passed |
| `net-queue.test.ts` | 9 passed |
| `ui/leaderboard/__tests__/worldBest.test.ts` | 3 passed |
| **Total** | **58 passed, 0 failed** |

Repo-wide, run immediately after (confirms nothing else broken):

```
$ npx vitest run
 Test Files  48 passed (48)
      Tests  763 passed | 1 skipped (764)
```

`npm run typecheck` (`tsc --build --force`, repo-wide): **clean under every file I own.** The only
error present anywhere in the tree is `packages/web/src/editor/editor.ts:891` — confirmed to be
T-11 DRAFT's file, actively being edited concurrently per the orchestrator's own note, not mine and
not caused by anything here.

## Wiring the orchestrator needs

Nothing under `ui/leaderboard/**` or `net/**` is imported by the running app yet. Every integration
point below is a file I do not own (T-08 BRIDGE's `ui/**` or T-09 GAUGE's `hud/**`), so I'm
describing the exact change rather than making it.

**1. `packages/web/src/ui/app.ts` — construct one `Api` + one `SubmissionQueue` per app lifetime.**
```ts
import { createApi } from "../net/index.js";
import { createSubmissionQueue } from "../net/queue.js";
// inside mountApp(root):
const api = createApi(/* production API base URL, e.g. "" for same-origin /api/* on Vercel */);
const queue = createSubmissionQueue({ baseUrl: /* same base URL */ "" });
// thread `api`/`queue` into ScreenCtx (screen.ts) alongside `storage`/`router`, or into whatever
// eventually constructs GameSession + mountGauge for the /play/:levelId route (see point 2 — no
// such constructor exists anywhere in the tree yet, per T-08's own log).
```

**2. The completion-panel call site (wherever `GameSession` + `mountGauge` get constructed —
does not exist yet; `ui/screens/play.ts` is deliberately a chrome-only placeholder per T-08's log).**
On `session.onComplete`, after `storage.recordBest(...)` runs and only when the DoD's submission
rules are met (not a custom/shared level; the run beat the player's own personal best; the tape is
present) — this exact local check belongs in that new file, not in `net/**`:
```ts
complete.setRank({ status: "loading" });
const id = queue.submit({ levelId, metric, timeMs: payload.timeMs, boostMs: payload.boostMs, name: storage.getSettings().username, tape: payload.tape });
const unsub = queue.subscribe((e) => {
  if (e.id !== id) return;
  if (e.status === "succeeded") complete.setRank({ status: "loaded", rank: e.rank });
  else if (e.status === "rejected" || e.status === "dropped") complete.setRank({ status: "error" });
  // "retry-scheduled"/"rate-limited"/"submitting" -> leave at "loading", or add a QueueEvent branch
  // to RankSlot if finer-grained UI is wanted later.
});
```
`RankSlot`'s four states (`hud/complete.ts`) map onto `QueueEvent.status` exactly as above — no
change needed to T-09's file, just this translation at the call site.

**3. `packages/web/src/ui/screens/levelSelect.ts`'s `levelCard()` (line ~14-18) — one-line addition
to the existing `meta` array, using the exact pattern already there:**
```ts
import { formatWorldBest } from "../leaderboard/worldBest.js";
// ...
const meta: string[] = [];
if (vm.isCustom) meta.push(`by ${vm.author}`);
if (showTimes && vm.best) meta.push(`best ${formatMs(vm.best.timeMs)}`, `${formatMs(vm.best.boostMs)} boost`);
const worldBest = formatWorldBest(cachedLeaderboardFor(vm.id)); // needs a fetched-and-cached
if (worldBest) meta.push(worldBest);                             // LeaderboardEntry[] per level —
                                                                    // level select currently has no
                                                                    // network access at all.
```
This needs `levelSelect.ts` (or `app.ts`) to have fetched `api.leaderboard(id, "fastest")` for
visible levels ahead of time (a real design decision — fetch on-demand per card vs. batch — left to
the orchestrator since it touches render timing in a file I don't own).

**4. `packages/web/src/ui/screens/sharedPlaceholder.ts` — replace with a real fetch:**
```ts
const level = await api.fetchLevel(ctx.params.shareId ?? "");
// on success: hand `level` to whatever constructs GameSession (same gap as point 2); on rejection
// (fetchLevel throws for 404/malformed/unreachable): show the existing "not found"-style message.
```

**5. `packages/web/src/editor/**` (T-11 DRAFT, in progress) — a "Share" action calling:**
```ts
const { url } = await api.shareLevel(level); // throws on failure — catch and show an inline error
```

## Could not verify

- **No route has ever been exercised against a real deployed API.** T-12 LEDGER is done-pending-
  database (its own results.md: schema proven against a real local Postgres, but never against Neon
  or a real Vercel cold start). Every number above is measured against `test/mock-api.ts`, a real
  HTTP server implementing the documented contract faithfully — strictly better evidence than a
  fetch-mock, but not the same as hitting the real deployment.
- **The completion panel / level select / editor / shared-level wiring described above is untested
  in a real browser**, because it does not exist in the tree yet — no task's file-ownership row
  covers constructing `GameSession` + `mountGauge` together. What's proven is the client half in
  isolation (every `Api`/`queue` method, end-to-end against a real server) and the presentational
  half in isolation (real-browser screenshots) — not the two connected.
- **A genuinely hung DNS lookup** (as opposed to a hung TCP connection, which IS proven) was not
  separately reproduced — this sandboxed network's behaviour for an unroutable address was not
  reliable enough to build a stable test around; the "accepts connection, never responds" case
  (`net-http.test.ts`, `net-index.test.ts`) exercises the same client-side abort mechanism, so the
  timeout guarantee itself is proven, just not from that exact network failure mode.
- **Real mobile touch/viewport behaviour** beyond the 360px screenshot (no physical device in this
  environment — same limitation T-08's log records for its own screenshots).
