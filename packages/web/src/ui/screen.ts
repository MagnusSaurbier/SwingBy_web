// T-08 BRIDGE — the contract every screen module implements. Kept tiny and DOM-return-based (a
// screen hands back a built subtree once; app.ts swaps it into #app) rather than anything
// component-lifecycle-shaped — see notes/T-08-BRIDGE/log.md's framework decision.

import type { Storage } from "../storage/index.js";
import type { Api } from "../net/index.js";
import type { SubmissionQueue } from "../net/queue.js";
import type { NavigateOptions, Router } from "./router.js";

export interface ScreenCtx {
  storage: Storage;
  router: Router;
  params: Record<string, string>;
  navigate(path: string, opts?: NavigateOptions): void;
  /** Rebuilds and swaps in the current screen from scratch — call after a state mutation the
   *  visible DOM needs to reflect (e.g. a setting changed, a level was completed). */
  rerender(): void;
  /** T-13 PODIUM's leaderboard/sharing client. One instance per app lifetime (constructed in
   *  `app.ts`), degrades gracefully (never throws for `leaderboard`/`submitScore`; `shareLevel`/
   *  `fetchLevel` reject and callers must catch — see net/index.ts's own header comment). */
  api: Api;
  /** T-13 PODIUM's offline-safe score submission queue, backed by the same storage substrate as
   *  T-10 VAULT. `submit()` never blocks — see net/queue.ts. */
  queue: SubmissionQueue;
}

export interface ScreenResult {
  el: HTMLElement;
  /** Cleanup for anything the screen attached outside its own subtree (document/window listeners,
   *  timers). Omit if the screen has none — most don't; only Settings (rebind capture) and Play
   *  (Escape-to-pause, InputSource instance) currently need it. */
  destroy?: () => void;
}

export type ScreenFn = (ctx: ScreenCtx) => ScreenResult;
