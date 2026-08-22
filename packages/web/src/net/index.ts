// The leaderboard/sharing client (docs/INTERFACES.md "web/net/index.ts" — `LeaderboardEntry`,
// `Api`, `createApi(baseUrl)` below match it exactly).
//
// The rule that matters most: "The game is fully playable with the API unreachable." Every method
// here degrades instead of throwing wherever its return type has room to encode failure
// (`leaderboard` -> `[]`, `submitScore` -> `{accepted:false}`). `shareLevel` and `fetchLevel` are
// the two exceptions — their return types (`Promise<{id,url}>`, `Promise<Level>`) have no failure
// slot, so a genuine failure has nowhere to go but a rejection; callers of those two (the editor's
// Share action, the `/l/:shareId` route) MUST catch. This is spelled out exactly, with the wiring
// each caller needs, in notes/archive/T-13-PODIUM/results.md.
//
// No import from `core/physics`, `game/loop`, or `render/` anywhere in this module or the modules
// it imports — checked directly below: only `@swingby/core`'s top-level types/`validate()`
// (level.ts, not physics.ts) and this package's own `net/**` siblings.

import type { Level, ReplayTape } from "@swingby/core";
import {
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  REQUEST_TIMEOUT_MS,
  requestJson,
  type HttpOutcome,
} from "./http.js";
import {
  parseLeaderboardEntries,
  parseLevelResponse,
  parseScoreResponse,
  parseShareResponse,
  sanitizeOutgoingName,
} from "./validate.js";

export interface LeaderboardEntry {
  rank: number;
  name: string;
  timeMs: number;
  boostMs: number;
  verified: boolean;
}

export interface SubmitScoreRequest {
  levelId: string;
  metric: string;
  timeMs: number;
  boostMs: number;
  name: string;
  tape: ReplayTape;
}

export interface Api {
  leaderboard(
    levelId: string,
    metric: "fastest" | "efficient",
  ): Promise<LeaderboardEntry[]>;
  submitScore(
    s: SubmitScoreRequest,
  ): Promise<{ accepted: boolean; rank?: number }>;
  shareLevel(level: Level): Promise<{ id: string; url: string }>;
  fetchLevel(id: string): Promise<Level>;
}

/**
 * Builds the exact JSON body `POST /api/score` expects — nothing beyond the documented fields:
 * no fingerprinting, no analytics smuggled in. Exported (not just used
 * internally) so `queue.ts` can build the identical payload without duplicating field selection —
 * one place decides what a score submission body looks like on the wire.
 */
export function buildScoreRequestBody(
  s: SubmitScoreRequest,
): Record<string, unknown> {
  return {
    levelId: s.levelId,
    metric: s.metric,
    timeMs: s.timeMs,
    boostMs: s.boostMs,
    name: sanitizeOutgoingName(s.name),
    tape: s.tape,
  };
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

/**
 * The actual `fetch` call behind `POST /api/score`, returning the RICH `HttpOutcome` (not the
 * frozen narrow shape) — shared with `queue.ts`, which needs to tell "rate limited, retry in Ns"
 * apart from "network is down" apart from "server permanently rejected this" to back off
 * correctly. See notes/T-13-PODIUM/log.md finding 2 for why `Api.submitScore`'s own frozen return
 * type cannot carry that distinction.
 */
export async function postScore(
  baseUrl: string,
  s: SubmitScoreRequest,
): Promise<HttpOutcome<unknown>> {
  return requestJson(`${baseUrl}/api/score`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(buildScoreRequestBody(s)),
  });
}

function encodeQuery(params: Record<string, string>): string {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

/** Best-effort share URL for a freshly-minted level id. Prefers the page's own origin (so a share
 *  link points at THIS deployment's `/l/:id` route, per T-08's routing table, not at the API host,
 *  which may differ from the site host in local dev against `test/mock-api.ts`); falls back to
 *  `baseUrl` itself when `window`/`location` isn't available (e.g. under plain-Node vitest). */
function buildShareUrl(baseUrl: string, id: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/l/${id}`;
  }
  return `${baseUrl}/l/${id}`;
}

export function createApi(baseUrl: string): Api {
  return {
    async leaderboard(
      levelId: string,
      metric: "fastest" | "efficient",
    ): Promise<LeaderboardEntry[]> {
      const query = encodeQuery({ level: levelId, metric });
      const outcome = await requestJson<unknown>(
        `${baseUrl}/api/leaderboard?${query}`,
      );
      if (outcome.kind !== "ok") return [];
      return parseLeaderboardEntries(outcome.value);
    },

    async submitScore(
      s: SubmitScoreRequest,
    ): Promise<{ accepted: boolean; rank?: number }> {
      const outcome = await postScore(baseUrl, s);
      if (outcome.kind !== "ok") return { accepted: false };
      return parseScoreResponse(outcome.value);
    },

    async shareLevel(level: Level): Promise<{ id: string; url: string }> {
      const outcome = await requestJson<unknown>(`${baseUrl}/api/levels`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: level.name,
          author: level.author,
          data: level,
        }),
      });
      if (outcome.kind !== "ok") {
        throw new Error(`shareLevel failed: ${outcome.kind}`);
      }
      const parsed = parseShareResponse(outcome.value);
      if (!parsed) {
        throw new Error("shareLevel failed: malformed response");
      }
      return { id: parsed.id, url: buildShareUrl(baseUrl, parsed.id) };
    },

    async fetchLevel(id: string): Promise<Level> {
      const outcome = await requestJson<unknown>(
        `${baseUrl}/api/levels/${encodeURIComponent(id)}`,
      );
      if (outcome.kind !== "ok") {
        throw new Error(`fetchLevel failed: ${outcome.kind}`);
      }
      const level = parseLevelResponse(outcome.value);
      if (!level) {
        throw new Error(
          "fetchLevel failed: malformed or invalid level payload",
        );
      }
      return level;
    },
  };
}

export { REQUEST_TIMEOUT_MS, DEFAULT_RATE_LIMIT_BACKOFF_MS };
export type { HttpOutcome } from "./http.js";
export {
  parseLeaderboardEntries,
  parseLevelResponse,
  parseScoreResponse,
  parseShareResponse,
  sanitizeDisplayName,
} from "./validate.js";
