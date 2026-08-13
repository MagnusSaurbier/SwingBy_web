/**
 * T-14 LAUNCHPAD scaffold entry point.
 *
 * This is NOT the real app shell — tasks/T-08-BRIDGE.md owns `packages/web/src/main.ts` as its
 * "app entry + router" deliverable (see its "Owned files" section; INTERFACES.md's ownership
 * table itself only assigns T-08 `packages/web/src/ui/**`, so treat this file as a seed T-08
 * replaces wholesale, not a contract to preserve).
 *
 * Its only job right now is to prove the pipeline is real end to end:
 *   - `npm run dev -w @swingby/web`   serves this and hot-reloads it
 *   - `npm run build -w @swingby/web` bundles it, imports `@swingby/core` across the workspace
 *     boundary, and the output is what `npm run size` measures
 *
 * It deliberately imports nothing from `game/`, `ui/`, `render/`, `hud/`, `storage/`, `editor/`,
 * or `net/` — those belong to other tasks landing concurrently and may not exist yet. The one
 * cross-package import below (`@swingby/core`) is exercised on purpose, to prove workspace
 * resolution and tree-shaking work, not just that an empty file compiles.
 */
import { TPS, MAX_WORLD_BOUNDS_X, MAX_WORLD_BOUNDS_Y } from "@swingby/core";

const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main style="
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 2rem; box-sizing: border-box; text-align: center;
      background: #05070d; color: #e8f6ff; font-family: system-ui, -apple-system, sans-serif;
    ">
      <h1 style="margin: 0 0 0.5rem; font-weight: 600; letter-spacing: 0.02em;">SwingBy</h1>
      <p style="margin: 0; opacity: 0.7; max-width: 32rem;">
        Launchpad scaffold — the build pipeline is live. Simulation core runs at ${TPS} Hz across
        a ${MAX_WORLD_BOUNDS_X.toFixed(0)}&times;${MAX_WORLD_BOUNDS_Y.toFixed(0)} world.
        The real menu (T-08 BRIDGE) replaces this screen.
      </p>
    </main>
  `;
}
