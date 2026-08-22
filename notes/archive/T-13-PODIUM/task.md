# T-13 · PODIUM — Leaderboard and sharing client

**Area:** `packages/web/src/net` · **Depends on:** T-12 LEDGER *(interface only)* · **Blocks:** nothing

## Goal

The client half of the online features: fetch and display leaderboards, submit verified scores,
share and load custom levels by link.

## Owned files

```
packages/web/src/net/**
packages/web/src/ui/leaderboard/**     (exception to T-08's ui/ ownership — coordinate)
```

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#webnetindexts--t-13-podium).

## The rule that matters most

**The game is fully playable with the API unreachable.** SwingBy is single-player; the network is an
enhancement and must never be on a critical path.

- Never block a level start, a restart, or a completion panel on a request.
- Submission is fire-and-forget with retry. Show the completion panel immediately; fold the rank in
  when it arrives.
- Leaderboard fetch failure → show personal bests and a quiet "offline" note. Not an error dialog.
- Queue failed submissions in T-10 VAULT and retry on next load. A player on a train should not lose
  a personal best because the tunnel ate the request.
- Time out aggressively (3–5 s). A hung request must not leave the UI in a pending state.

## Where it appears

| Surface | Content |
|---|---|
| Level complete panel | Your rank, the top few, whether this run was verified |
| Level select | Optional world-best per level next to your personal best |
| Editor save | "Share" action → returns a URL |
| `/l/:shareId` | Loads a shared level straight into play |

## Submission flow

T-05 FLYWHEEL hands you `{ timeMs, boostMs, tape }` on completion. Submit it with the username from
T-10 VAULT. Do not submit when:

- Playing a custom or shared level (no leaderboard for those in v1 — flag if you disagree)
- The run did not beat the player's own personal best for that metric
- The tape is missing or malformed

That last check is local; do not spend a round trip discovering what T-02 can tell you instantly.

## Displaying verification

The API returns `verified` per entry. Show it — a small marker on verified runs. It is the whole
reason the replay machinery exists, and making it visible is what makes the leaderboard credible.
Unverified entries sort below verified ones regardless of value; mirror the server's ordering rather
than re-sorting client-side.

## Privacy

Usernames are free text rendered on a public page. Escape on output. The API caps and strips at
write time (T-12), but do not rely on that alone — a stored value predating a rule change is exactly
how XSS lands.

Do not send anything beyond `{ levelId, metric, timeMs, boostMs, name, tape }`. No fingerprinting,
no analytics smuggled into the score payload.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `createApi` + the `Api` interface, with timeouts and retry | `packages/web/src/net/index.ts` |
| 2 | Offline submission queue, backed by T-10 VAULT | `packages/web/src/net/queue.ts` |
| 3 | Leaderboard UI: completion panel and level select | `packages/web/src/ui/leaderboard/**` |
| 4 | Local mock server for development and tests | `packages/web/test/mock-api.ts` |
| 5 | Screenshots: leaderboard populated, and the offline state | — |

## Definition of done

- [ ] **Every method degrades gracefully with the API genuinely unreachable** — test with it down,
      not merely slow
- [ ] A completed level submits once and shows a rank
- [ ] No duplicate submissions on retry — idempotency key agreed with T-12
- [ ] Queued submissions retry on next load
- [ ] Share produces a working URL; opening it loads the level
- [ ] Usernames containing `<script>` render as literal text
- [ ] Requests time out (3–5 s) and recover; no permanently pending UI
- [ ] Nothing beyond the documented fields is sent — no fingerprinting, no analytics
- [ ] Verified entries display their marker and sort above unverified
- [ ] No import from `core/physics`, `game/loop`, or `render/`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working without T-12

The API contract is frozen. Build against a local mock — a small in-memory handler behind the same
routes is enough to develop every surface here, including the failure paths, which are the ones
worth exercising.

## How to verify

```bash
npm test -w @swingby/web -- net
npm run dev -w @swingby/web
```

**1. Offline — genuinely offline, not slow.** DevTools → Network → Offline, then:
- Start a level, complete it, and confirm the completion panel appears **immediately** with personal
  bests and a quiet offline note.
- Confirm the submission is queued, then go online, reload, and confirm it submits.

Then point the client at a dead host (not just offline) and repeat. A hung DNS lookup behaves
differently from a refused connection, and only one of them is covered by the offline toggle.

**2. No duplicates.** With the network flapping (offline/online every 2 s), complete a level and
confirm exactly one row lands. Check with T-12's leaderboard endpoint, not the UI.

**3. Timeout.** Add a 30 s delay to the mock. The UI must give up at 3–5 s and never sit pending.

**4. XSS.** Submit a score with the name `<img src=x onerror=alert(1)>` and confirm it renders as
literal text on the leaderboard, in the completion panel, and in level select.

**5. Payload discipline.** Network tab → inspect the score request body. It must contain exactly
`levelId, metric, timeMs, boostMs, name, tape` and nothing else.

**6. Sharing.** Share a level from the editor, open the returned URL in a fresh private window, and
confirm it loads and plays without any local state.
