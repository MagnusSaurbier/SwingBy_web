// T-13 PODIUM — deliverable 4: a local mock server for development and tests
// (tasks/T-13-PODIUM.md: "Build against a local mock — a small in-memory handler behind the same
// routes is enough to develop every surface here, including the failure paths, which are the ones
// worth exercising.")
//
// A REAL `node:http` server (not a `fetch` monkeypatch), bound to an ephemeral loopback port. Three
// reasons, any one sufficient (see notes/T-13-PODIUM/log.md "Screenshot plan" / "Design"):
//   1. `createApi(baseUrl)`'s signature is frozen to exactly one parameter (INTERFACES.md) — there
//      is no slot to inject a fake `fetch` into it even if I wanted to. A real server sidesteps
//      that: `createApi` never needs to know it's talking to a mock.
//   2. It exercises the REAL network stack — real timeouts, real concurrent connections, a real
//      `AbortController` abort on the wire — the same reasoning T-12 LEDGER used to prefer a real
//      local Postgres over a mock for its own DB-shaped work.
//   3. `npm run dev -w @swingby/web` can point at it directly for real interactive development
//      against every route, including the failure paths, without a live Neon database.
//
// Reimplements T-12's rate-limit ALGORITHM locally (sliding window, same shape as
// `api/_ratelimit.ts`'s `createRateLimiter`) rather than importing `api/_ratelimit.ts` — `api/` is
// a different task's package, not a dependency of `@swingby/web`, and coupling test infra to
// another task's private module path is worse than ~15 lines of duplication.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockLeaderboardEntry {
  rank: number;
  name: string;
  timeMs: number;
  boostMs: number;
  verified: boolean;
}

export interface MockRequestLogEntry {
  method: string;
  path: string;
  body: unknown;
  at: number;
}

export interface ParsedMockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  bodyRaw: string;
  bodyJson: unknown;
}

/** A route handler returns either a concrete response, or `"hang"` to accept the connection and
 *  never write a response at all — the shape needed to prove a client-side timeout actually fires
 *  (tasks/T-13-PODIUM.md "How to verify" step 3: "Add a 30s delay to the mock. The UI must give up
 *  at 3-5s and never sit pending."). */
export type MockRouteResult =
  | { status: number; bodyRaw: string; headers?: Record<string, string> }
  | "hang";

export type MockRouteOverride = (
  req: ParsedMockRequest,
) => MockRouteResult | Promise<MockRouteResult>;

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface MockApiOptions {
  /** Defaults match T-12 LEDGER's real, measured configuration exactly (api/_ratelimit.ts
   *  `SCORE_RATE_LIMIT`) — 8 requests per 60s sliding window. */
  scoreRateLimit?: RateLimitConfig;
  /** Defaults match `LEVEL_RATE_LIMIT` — 5 requests per 60s sliding window. */
  levelRateLimit?: RateLimitConfig;
  /** Injectable clock, so a test can fast-forward past a rate-limit window without a real 60s
   *  sleep. Defaults to the real wall clock. */
  now?: () => number;
}

export interface MockApiHandle {
  url: string;
  /** Every request the server received, in arrival order. Read directly (not cloned) — tests treat
   *  it as a log, not something they mutate. */
  requests: MockRequestLogEntry[];
  close(): Promise<void>;
  /** Clears the request log and all rate-limit counters. Leaves seeded leaderboard/level data and
   *  any route overrides untouched. */
  reset(): void;
  seedLeaderboard(
    levelId: string,
    metric: "fastest" | "efficient",
    entries: MockLeaderboardEntry[],
  ): void;
  seedLevel(
    id: string,
    level: { name: string; author: string; data: unknown },
  ): void;
  setScoreHandler(fn: MockRouteOverride | null): void;
  setLeaderboardHandler(fn: MockRouteOverride | null): void;
  setLevelsCreateHandler(fn: MockRouteOverride | null): void;
  setLevelGetHandler(fn: MockRouteOverride | null): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Sliding-window counter — same algorithm as `api/_ratelimit.ts`'s `createRateLimiter`,
 *  reimplemented (not imported, see file header). */
function createLimiter(cfg: RateLimitConfig, now: () => number) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): { allowed: boolean; retryAfterMs: number } {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < cfg.windowMs);
      if (recent.length >= cfg.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? t;
        return {
          allowed: false,
          retryAfterMs: Math.max(0, cfg.windowMs - (t - oldest)),
        };
      }
      recent.push(t);
      hits.set(key, recent);
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(): void {
      hits.clear();
    },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockApi(
  opts: MockApiOptions = {},
): Promise<MockApiHandle> {
  const now = opts.now ?? (() => Date.now());
  const scoreLimiter = createLimiter(
    opts.scoreRateLimit ?? { limit: 8, windowMs: 60_000 },
    now,
  );
  const levelLimiter = createLimiter(
    opts.levelRateLimit ?? { limit: 5, windowMs: 60_000 },
    now,
  );

  const requests: MockRequestLogEntry[] = [];
  const leaderboards = new Map<string, MockLeaderboardEntry[]>();
  const levels = new Map<
    string,
    { name: string; author: string; data: unknown }
  >();
  let nextLevelNum = 1;

  let scoreOverride: MockRouteOverride | null = null;
  let leaderboardOverride: MockRouteOverride | null = null;
  let levelsCreateOverride: MockRouteOverride | null = null;
  let levelGetOverride: MockRouteOverride | null = null;

  function leaderboardKey(levelId: string, metric: string): string {
    return `${levelId}:${metric}`;
  }

  async function route(req: ParsedMockRequest): Promise<MockRouteResult> {
    if (req.method === "GET" && req.path === "/api/leaderboard") {
      if (leaderboardOverride) return leaderboardOverride(req);
      const levelId = req.query.get("level") ?? "";
      const metric =
        req.query.get("metric") === "efficient" ? "efficient" : "fastest";
      const entries = leaderboards.get(leaderboardKey(levelId, metric)) ?? [];
      return { status: 200, bodyRaw: JSON.stringify({ entries }) };
    }

    if (req.method === "POST" && req.path === "/api/score") {
      const limit = scoreLimiter.check("test-client");
      if (!limit.allowed) {
        return {
          status: 429,
          bodyRaw: JSON.stringify({
            accepted: false,
            verified: false,
            reason: "rate-limited",
          }),
          headers: {
            "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
          },
        };
      }
      if (scoreOverride) return scoreOverride(req);
      if (!isPlainObject(req.bodyJson)) {
        return {
          status: 400,
          bodyRaw: JSON.stringify({
            accepted: false,
            verified: false,
            reason: "malformed-body",
          }),
        };
      }
      const body = req.bodyJson;
      const levelId = typeof body.levelId === "string" ? body.levelId : "";
      const metric = body.metric === "efficient" ? "efficient" : "fastest";
      const timeMs = typeof body.timeMs === "number" ? body.timeMs : 0;
      const boostMs = typeof body.boostMs === "number" ? body.boostMs : 0;
      const name =
        typeof body.name === "string" && body.name.length > 0
          ? body.name
          : "Anonymous";
      const key = leaderboardKey(levelId, metric);
      const list = leaderboards.get(key) ?? [];
      const entry: MockLeaderboardEntry = {
        rank: 0,
        name,
        timeMs,
        boostMs,
        verified: true,
      };
      list.push(entry);
      list.sort((a, b) =>
        metric === "fastest" ? a.timeMs - b.timeMs : a.boostMs - b.boostMs,
      );
      list.forEach((e, i) => {
        e.rank = i + 1;
      });
      leaderboards.set(key, list);
      return {
        status: 200,
        bodyRaw: JSON.stringify({
          accepted: true,
          verified: true,
          rank: entry.rank,
        }),
      };
    }

    if (req.method === "POST" && req.path === "/api/levels") {
      const limit = levelLimiter.check("test-client");
      if (!limit.allowed) {
        return {
          status: 429,
          bodyRaw: JSON.stringify({ error: "rate-limited" }),
          headers: {
            "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
          },
        };
      }
      if (levelsCreateOverride) return levelsCreateOverride(req);
      if (!isPlainObject(req.bodyJson)) {
        return {
          status: 400,
          bodyRaw: JSON.stringify({ error: "malformed-body" }),
        };
      }
      const body = req.bodyJson;
      const id = `mock${String(nextLevelNum++).padStart(4, "0")}`;
      levels.set(id, {
        name: typeof body.name === "string" ? body.name : "",
        author: typeof body.author === "string" ? body.author : "",
        data: body.data,
      });
      return { status: 200, bodyRaw: JSON.stringify({ id }) };
    }

    const levelGetMatch = /^\/api\/levels\/([^/]+)$/.exec(req.path);
    if (req.method === "GET" && levelGetMatch) {
      if (levelGetOverride) return levelGetOverride(req);
      const id = levelGetMatch[1] as string;
      const row = levels.get(id);
      if (!row)
        return {
          status: 404,
          bodyRaw: JSON.stringify({ error: "level-not-found" }),
        };
      return {
        status: 200,
        bodyRaw: JSON.stringify({
          id,
          name: row.name,
          author: row.author,
          data: row.data,
        }),
      };
    }

    return { status: 404, bodyRaw: JSON.stringify({ error: "not-found" }) };
  }

  // Permissive CORS: this mock is explicitly meant to be usable from `npm run dev -w @swingby/web`
  // (a different origin/port than the mock server itself), per the task doc's "for development and
  // tests" framing, and from the standalone screenshot harness (notes/T-13-PODIUM/log.md). A real
  // deployment serves `/api/*` same-origin (Vercel), so this is mock-only convenience, never
  // shipped — `test/mock-api.ts` is not part of any build output.
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  } as const;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      if (method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      const fullUrl = new URL(req.url ?? "/", "http://localhost");
      const bodyRaw = await readBody(req);
      let bodyJson: unknown;
      try {
        bodyJson =
          bodyRaw.length > 0 ? (JSON.parse(bodyRaw) as unknown) : undefined;
      } catch {
        bodyJson = undefined;
      }

      const parsed: ParsedMockRequest = {
        method,
        path: fullUrl.pathname,
        query: fullUrl.searchParams,
        bodyRaw,
        bodyJson,
      };
      requests.push({
        method,
        path: fullUrl.pathname,
        body: bodyJson,
        at: now(),
      });

      let result: MockRouteResult;
      try {
        result = await route(parsed);
      } catch (err) {
        result = {
          status: 500,
          bodyRaw: JSON.stringify({
            error: "mock-internal-error",
            message: String(err),
          }),
        };
      }

      if (result === "hang") return; // deliberately never respond — see MockRouteResult doc.
      res.writeHead(result.status, {
        "content-type": "application/json",
        ...CORS_HEADERS,
        ...result.headers,
      });
      res.end(result.bodyRaw);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    requests,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    reset(): void {
      requests.length = 0;
      scoreLimiter.reset();
      levelLimiter.reset();
    },
    seedLeaderboard(levelId, metric, entries): void {
      leaderboards.set(
        leaderboardKey(levelId, metric),
        entries.map((e) => ({ ...e })),
      );
    },
    seedLevel(id, level): void {
      levels.set(id, { ...level });
    },
    setScoreHandler(fn): void {
      scoreOverride = fn;
    },
    setLeaderboardHandler(fn): void {
      leaderboardOverride = fn;
    },
    setLevelsCreateHandler(fn): void {
      levelsCreateOverride = fn;
    },
    setLevelGetHandler(fn): void {
      levelGetOverride = fn;
    },
  };
}
