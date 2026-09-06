/**
 * Keeps the collapsed hint button (hud.css's `.sb-hud-hint.sb-collapsed`) clear of the top HUD
 * band (level info + stats), by publishing that band's actual rendered height as the
 * `--sb-hud-avoid-top` custom property on `.sb-hud`, which the collapsed rule reads via `var()`.
 *
 * A fixed CSS offset can't do this reliably: the top band stacks level+stats vertically under the
 * 400px breakpoint (hud.css's "360px checkpoint" section) instead of side-by-side, and the stats
 * box itself grows or shrinks a line at a time as `showTimes`/`showHighscores`/`showFps` are
 * toggled in Settings — so "how far down the collapsed button needs to sit" isn't a constant.
 *
 * Measured with `getBoundingClientRect`, which is why this lives outside hud.ts — that file's own
 * doc comment bans it from the 144Hz render loop. This runs only at mount, on window resize, and
 * whenever the caller's own settings change (see hud.ts's `refreshSettings`) — never per frame.
 */
export interface HintAvoidTopHandle {
  /** Re-measures immediately — call after anything that can change the top band's height (a
   *  settings change; hud.ts's `refreshSettings` calls this). */
  update(): void;
  destroy(): void;
}

export function attachHintAvoidTop(
  root: HTMLElement,
  topBand: HTMLElement,
): HintAvoidTopHandle {
  // No `window`, and no real `getBoundingClientRect` (hud/__tests__/fakeDom.ts's fake elements
  // don't implement it — see its own doc comment), under the plain-Node vitest environment
  // hud.test.ts runs in — mounting the HUD there must not throw just because live layout
  // measurement is untestable without a real DOM/window. The `56px` CSS fallback covers this case.
  const win = typeof window === "undefined" ? null : window;
  const canMeasure = typeof root.getBoundingClientRect === "function";

  function update(): void {
    if (!canMeasure) return;
    const rootRect = root.getBoundingClientRect();
    const topBandRect = topBand.getBoundingClientRect();
    const clearance = Math.max(0, topBandRect.bottom - rootRect.top);
    root.style.setProperty("--sb-hud-avoid-top", `${clearance}px`);
  }

  update();
  // `root` isn't attached to the document yet at construction time — hud.ts's own caller
  // (hud/index.ts's `mountGauge`) appends `hud.el` to the page only AFTER `mountHud` returns, so
  // the synchronous `update()` above always measures a detached (all-zero) box. One more
  // measurement on the next animation frame — after that synchronous append has had a chance to
  // run and the browser has laid the page out — is what actually lands the real number.
  win?.requestAnimationFrame(update);
  win?.addEventListener("resize", update);

  return {
    update,
    destroy(): void {
      win?.removeEventListener("resize", update);
    },
  };
}
