// T-08 BRIDGE — root app shell. Wires the router to the six screens (+ three placeholders for
// routes other tasks own the content of) and owns the single `createStorage()` instance every
// screen shares.

import { createStorage } from "../storage/index.js";
import { createApi } from "../net/index.js";
import { createSubmissionQueue } from "../net/queue.js";
import { createRouter, matchRoute, type RouteDef } from "./router.js";
import type { ScreenCtx, ScreenFn } from "./screen.js";
import { renderMenu } from "./screens/menu.js";
import { renderLevelSelect } from "./screens/levelSelect.js";
import { renderWorkshop } from "./screens/workshop.js";
import { renderSettings } from "./screens/settings.js";
import { renderCredits } from "./screens/credits.js";
import { renderPlay } from "./screens/play.js";
import { renderEditorPlaceholder } from "./screens/editorPlaceholder.js";
import { renderSharedPlaceholder } from "./screens/sharedPlaceholder.js";
import { renderNotFound } from "./screens/notFound.js";

// Routing table. The task doc's own table lists only "/", "/play/:levelId", "/editor", "/l/:shareId"
// — the other four are additive so every screen the task doc calls "deep-linkable" (Level Select
// explicitly) actually has a real path. See notes/T-08-BRIDGE/log.md.
const ROUTES: readonly RouteDef[] = [
  { name: "menu", pattern: "/" },
  { name: "levels", pattern: "/levels" },
  { name: "workshop", pattern: "/workshop" },
  { name: "settings", pattern: "/settings" },
  { name: "credits", pattern: "/credits" },
  { name: "play", pattern: "/play/:levelId" },
  { name: "editor", pattern: "/editor" },
  { name: "shared", pattern: "/l/:shareId" },
];

const SCREENS: Record<string, ScreenFn> = {
  menu: renderMenu,
  levels: renderLevelSelect,
  workshop: renderWorkshop,
  settings: renderSettings,
  credits: renderCredits,
  play: renderPlay,
  editor: renderEditorPlaceholder,
  shared: renderSharedPlaceholder,
};

const TITLES: Record<string, string> = {
  menu: "SwingBy",
  levels: "Level Select — SwingBy",
  workshop: "Workshop — SwingBy",
  settings: "Settings — SwingBy",
  credits: "Credits — SwingBy",
  play: "SwingBy",
  editor: "Editor — SwingBy",
  shared: "Shared Level — SwingBy",
  notFound: "Not Found — SwingBy",
};

/** Verification-only escape hatch: set `window.__SWINGBY_API_BASE__` (e.g. via Playwright's
 *  `page.addInitScript`) BEFORE this module runs to point the app at a real local server —
 *  precisely how `results/T-08-BRIDGE.md`'s "populated leaderboard" screenshot was produced,
 *  against T-13's own `test/mock-api.ts`, without touching the production default. Absent, the
 *  default is always same-origin `""`; nothing in the shipped app ever sets this global. */
declare global {
  interface Window {
    __SWINGBY_API_BASE__?: string;
  }
}

function apiBaseUrl(): string {
  return (typeof window !== "undefined" && window.__SWINGBY_API_BASE__) || "";
}

export function mountApp(root: HTMLElement): () => void {
  const storage = createStorage();
  const router = createRouter();
  // Same-origin base URL: on the real deployment `/api/*` is served by the same Vercel project
  // (T-14's `vercel.json`), so "" is correct for production. In this container's `npm run dev`
  // there is no `/api` backend at all, so every call fails fast and both modules degrade exactly
  // per their own documented contract (`leaderboard()` -> `[]`, `submitScore()` -> queued/offline)
  // — that degradation IS the thing being verified, not a workaround. One instance of each per
  // app lifetime, per results/T-13-PODIUM.md's wiring note #1.
  const baseUrl = apiBaseUrl();
  const api = createApi(baseUrl);
  const queue = createSubmissionQueue({ baseUrl });

  let destroyCurrent: (() => void) | null = null;

  function render(): void {
    destroyCurrent?.();
    destroyCurrent = null;

    const path = router.current();
    const match = matchRoute(path, ROUTES);
    const name = match?.name ?? "notFound";
    const screenFn = SCREENS[name] ?? renderNotFound;

    const ctx: ScreenCtx = {
      storage,
      router,
      params: match?.params ?? {},
      navigate: (p, opts) => router.navigate(p, opts),
      rerender: render,
      api,
      queue,
    };

    const result = screenFn(ctx);
    root.replaceChildren(result.el);
    destroyCurrent = result.destroy ?? null;
    document.title = TITLES[name] ?? "SwingBy";
  }

  const unsubscribe = router.subscribe(render);
  render();

  return function unmount(): void {
    unsubscribe();
    destroyCurrent?.();
    router.destroy();
  };
}
