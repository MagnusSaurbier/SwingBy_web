/**
 * Drag + corner-snap behaviour for the hint card (hud.ts). Split out of hud.ts because hud.ts's
 * own doc comment bans `getBoundingClientRect`/`offsetWidth` from that file — a rule scoped to its
 * 144Hz `onSnapshot` render loop, not to discrete user-input handlers, but cleanest to just keep
 * the two concerns apart rather than carve out an exception. Everything here runs off pointer
 * events (user-input rate), never the per-frame loop.
 */

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Pure: which corner of a `width`x`height` box a point (e.g. a dragged card's center) is
 *  closest to. Extracted so the quadrant logic is unit-testable without a DOM. */
export function nearestCorner(
  x: number,
  y: number,
  width: number,
  height: number,
): Corner {
  const left = x < width / 2;
  const top = y < height / 2;
  if (top) return left ? "top-left" : "top-right";
  return left ? "bottom-left" : "bottom-right";
}

/** Distance beyond which a pointerdown->pointerup is treated as a drag rather than a click/tap on
 *  the toggle button. */
const DRAG_THRESHOLD_PX = 6;

/** Gap kept between a snapped card and the edge of `container`. */
const CORNER_MARGIN_PX = 16;

export interface CornerDragHandle {
  /** True if the most recently finished pointer interaction moved past the drag threshold — the
   *  toggle button's own click handler checks this to ignore a click synthesized at the end of a
   *  drag rather than double-handling it. */
  wasDragged(): boolean;
  destroy(): void;
}

/** Makes `card` draggable by pointer within `container` (which must be `position: relative` or
 *  `absolute` and share the container's size — hud.ts's `.sb-hud` root fits both), snapping to the
 *  nearest corner of `container` on release. Dragging works from anywhere on `card`, including the
 *  collapse toggle button, so the collapsed (button-only) state stays draggable too. */
export function attachCornerDrag(
  card: HTMLElement,
  container: HTMLElement,
): CornerDragHandle {
  // No `window` under the plain-Node vitest environment this package's HUD tests run in (see
  // hud/__tests__/fakeDom.ts's own doc comment) — mounting the HUD there must not throw just
  // because dragging itself is untestable without a real DOM/window.
  const win = typeof window === "undefined" ? null : window;

  let dragging = false;
  let dragged = false;
  let startX = 0;
  let startY = 0;
  let grabDx = 0;
  let grabDy = 0;
  let activePointerId: number | null = null;

  function clearAnchors(): void {
    card.style.left = "";
    card.style.right = "";
    card.style.top = "";
    card.style.bottom = "";
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = true;
    dragged = false;
    startX = ev.clientX;
    startY = ev.clientY;
    activePointerId = ev.pointerId;
    const cardRect = card.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    grabDx = ev.clientX - cardRect.left;
    grabDy = ev.clientY - cardRect.top;
    card.style.transform = "none";
    clearAnchors();
    card.style.left = `${cardRect.left - containerRect.left}px`;
    card.style.top = `${cardRect.top - containerRect.top}px`;
    // Deliberately NOT `card.setPointerCapture(...)`: capturing on the card re-targets the
    // compat `mouseup`/`click` events to it too, per the Pointer Events spec — which means the
    // collapse-toggle button (a descendant) never gets its own native `click` for a plain tap.
    // The window-level move/up listeners below already track the drag with no capture needed.
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!dragging || ev.pointerId !== activePointerId) return;
    if (!dragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD_PX) {
      dragged = true;
    }
    const containerRect = container.getBoundingClientRect();
    card.style.left = `${ev.clientX - grabDx - containerRect.left}px`;
    card.style.top = `${ev.clientY - grabDy - containerRect.top}px`;
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!dragging || ev.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    if (!dragged) return; // a plain tap — leave position alone, the toggle's own click handles it
    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const centerX = cardRect.left + cardRect.width / 2 - containerRect.left;
    const centerY = cardRect.top + cardRect.height / 2 - containerRect.top;
    const corner = nearestCorner(centerX, centerY, containerRect.width, containerRect.height);
    clearAnchors();
    if (corner.startsWith("top")) card.style.top = `${CORNER_MARGIN_PX}px`;
    else card.style.bottom = `${CORNER_MARGIN_PX}px`;
    if (corner.endsWith("left")) card.style.left = `${CORNER_MARGIN_PX}px`;
    else card.style.right = `${CORNER_MARGIN_PX}px`;
  }

  card.addEventListener("pointerdown", onPointerDown);
  win?.addEventListener("pointermove", onPointerMove);
  win?.addEventListener("pointerup", onPointerUp);
  win?.addEventListener("pointercancel", onPointerUp);

  return {
    wasDragged: () => dragged,
    destroy(): void {
      card.removeEventListener("pointerdown", onPointerDown);
      win?.removeEventListener("pointermove", onPointerMove);
      win?.removeEventListener("pointerup", onPointerUp);
      win?.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
