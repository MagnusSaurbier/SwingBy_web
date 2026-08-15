/**
 * T-08 BRIDGE — app entry point.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DELIVERABLE 5 — Framework choice and reason (task doc: "Record the choice and the reason at
 * the top of main.ts").
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * CHOICE: plain TypeScript + DOM. No Svelte, no other UI framework or library. A ~150-line
 * hand-rolled router (ui/router.ts) using the real History API — no hash routing, no virtual DOM,
 * no build-time compiler step beyond esbuild's default TS/ESM handling that this repo already has.
 *
 * REASON (two, either sufficient alone — full reasoning in notes/T-08-BRIDGE/log.md):
 *
 * 1. Mechanical: wiring in Svelte requires an `@sveltejs/vite-plugin-svelte` entry in
 *    `vite.config.ts` and a new devDependency in `packages/web/package.json`. Neither file is
 *    mine to touch in this task's environment. There is no path to a compiled framework without
 *    editing one of them, so for this task plain DOM isn't merely preferred, it's the only
 *    workable choice.
 * 2. Budget: `npm run size` fails the whole build over 250 KB gzipped for everything —
 *    core + render + game + ui combined. Every byte of ui/ in this bundle is content, not
 *    framework runtime, because there is no framework runtime. T-04 AURORA already proved this
 *    codebase's convention works at this scale: a hand-rolled canvas renderer at 3.15 KB gzip.
 *    Six mostly-static screens (menu, level select, workshop, settings, credits, an in-game
 *    pause overlay) are squarely the same kind of "plain code beats a dependency" case.
 *
 * This stays entirely inside `ui/` and `main.ts`, per PROJECT.md §4 ("The UI layer may use Svelte
 * or plain DOM; that decision belongs to T-08 BRIDGE and must not leak into core, render, or
 * game.") — nothing under `core/`, `render/`, or `game/` imports anything from `ui/`.
 *
 * Routing note: real URLs via `history.pushState`, no base path (PROJECT.md / task doc: SwingBy
 * gets its own subdomain, so there is nothing to thread a `BASE_PATH` through — see
 * notes/T-08-BRIDGE/log.md for the routing table this app actually implements).
 */
import "./styles/index.css";
import { mountApp } from "./ui/app.js";

const root = document.getElementById("app");
if (!root) {
  throw new Error("main.ts: #app root element missing from index.html");
}

mountApp(root);
