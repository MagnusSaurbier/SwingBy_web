/**
 * T-11 DRAFT — deliverable 4: `EditorOverlay`, the published shape of `RenderFrame.editorOverlay`
 * (`packages/web/src/render/index.ts`, T-04 AURORA — frozen as `unknown` there on purpose:
 * "opaque to the renderer; T-11 DRAFT defines it"). T-04's own renderer NEVER reads this field —
 * confirmed by reading `render/index.ts` directly (draw() destructures `frame` and never touches
 * `editorOverlay`) and by T-04's own log ("no code reads it... T-11 DRAFT presumably renders it
 * separately on top"). This module is that separate paint pass: `paintEditorOverlay()` below grabs
 * the SAME canvas's 2D context again (idempotent per spec — `canvas.getContext("2d")` returns the
 * same object every call) right after `renderer.draw(frame)` returns, and draws on top using plain
 * canvas calls plus the real `renderer.worldToScreen` for every screen position it computes — never
 * a re-derivation of the transform math.
 *
 * Nothing in `render/**` needs to change for this to work; `frame.editorOverlay` is still populated
 * (by `editor.ts`, when it builds its own edit-mode `RenderFrame`) purely for documentation/
 * debuggability — a future caller inspecting a captured frame can see exactly what was being edited.
 */

import { ROCKET_SCALE } from "@swingby/core/constants";
import type { Body, BodyType } from "@swingby/core/types";
import type { Camera, Renderer } from "../render/index.js";
import { clampZoom } from "./viewport.js";

// ---------------------------------------------------------------------------
// The published contract
// ---------------------------------------------------------------------------

export type EditorTool = "select" | "place";

/** Which on-canvas contextual handle is being interacted with. */
export type HandleName = "move" | "velocity" | "resize" | "delete";

export interface OverlayButton {
  name: HandleName;
  x: number;
  y: number;
  hovered: boolean;
}

export interface PhantomGhost {
  type: BodyType;
  x: number;
  y: number;
}

/**
 * Everything the editor's own paint pass needs to draw the interactive chrome (selection ring,
 * hover ring, velocity arrows, gravity-influence rings, contextual buttons, placement ghost, the
 * "reset stage to edit" hint) on top of a plain `renderer.draw()` pass. Deliberately screen-agnostic
 * (world-space where it matters, `OverlayButton`s pre-positioned in screen space by the caller) so a
 * future non-canvas consumer (e.g. a debug inspector) could read it without touching a canvas.
 */
export interface EditorOverlay {
  tool: EditorTool;
  placeType: BodyType | null;
  selectedIndex: number;
  hoverIndex: number;
  /** Non-null while a placement ghost should be drawn (armed "place" tool, cursor over the canvas). */
  phantom: PhantomGhost | null;
  /** Non-null while an on-canvas handle drag is in progress. */
  dragging: { index: number; handle: HandleName } | null;
  /** True once the live preview has advanced at least one tick since it was last reset — see
   *  editor.ts's "preview-state gate" doc comment for why this is the chosen drift signal. Editing
   *  is disabled and a "reset stage to edit" hint is shown whenever this is true. */
  requiresReset: boolean;
  /** Pre-positioned (screen space) contextual buttons for the selected object, empty when nothing
   *  is selected or a drag is in progress. */
  buttons: readonly OverlayButton[];
  goalIndex: number;
}

// ---------------------------------------------------------------------------
// Button geometry — deliberately simplified vs. LevelEditor.gd's formulas; see notes/T-11-DRAFT/
// log.md decisions #8-9 for the reasoning (proportional-to-rendered-size hit radius, buttons shown
// only for the selected object rather than merely-hovered).
// ---------------------------------------------------------------------------

const BUTTON_RADIUS = 16;
const BUTTON_SPACING = 44;
const MIN_HIT_RADIUS = 24;

/** How many drawn radii out the resize handle rests — repo owner's number, 2026-08-20. */
export const RESIZE_REST_RADII = 3;

/**
 * The player's drawn half-height in screen px at zoom 1: `drawPlayer` (render/bodies.ts) scales the
 * rocket texture by `ROCKET_SCALE * zoom`, and the textures are 241-256 px tall
 * (`render/assets/rocket1..4.png`), so this is rocket1's 245 px halved and scaled. It has to be a
 * constant here rather than a measurement: the real dimensions live on the async-loaded `SpriteSet`
 * inside the renderer, which this module has no access to, and the four rockets differ by ~6 % so
 * there is no single true value anyway. The HUD glow circle (`44 * ROCKET_SCALE * zoom` ~ 7.5 px)
 * was the alternative and is rejected because it is far smaller than what the eye reads as the ship.
 */
const PLAYER_DRAWN_RADIUS_AT_ZOOM_1 = (245 / 2) * ROCKET_SCALE;

/**
 * The radius a body is actually DRAWN at, in screen px — mirrors `render/bodies.ts` exactly:
 * `drawSun` (`size * zoom`), `drawPlanet` (`max(6, size * 2.3 * zoom)`, floor included) and
 * `drawPlayer` (a sprite, so independent of `size` — see the constant above). Duplicated here
 * rather than imported because `render/` exports the draw calls, not their geometry; if those
 * formulas change, this must follow, which is why the tests restate them from `bodies.ts` instead
 * of calling this function.
 */
export function drawnRadiusPx(
  body: { type: BodyType; size: number },
  zoom: number,
): number {
  const z = clampZoom(zoom);
  switch (body.type) {
    case "sun":
      return body.size * z;
    case "planet":
      return Math.max(6, body.size * 2.3 * z);
    case "player":
      return PLAYER_DRAWN_RADIUS_AT_ZOOM_1 * z;
  }
}

/** On-screen hit/hover radius for a body, proportional to its actual rendered size. */
export function hoverRadiusPx(body: { size: number }, zoom: number): number {
  return Math.max(body.size * zoom + 10, MIN_HIT_RADIUS);
}

/** Which contextual buttons a body type has. Suns never get a velocity handle (they're stationary
 *  gravity sources) — mirrors `_contextual_circle_button_names` (LevelEditor.gd:227-234). The
 *  player never gets a delete handle — it is the stage's one permanent player object. */
export function buttonNamesFor(type: BodyType): readonly HandleName[] {
  if (type === "sun") return ["move", "resize", "delete"];
  if (type === "player") return ["move", "velocity", "resize"];
  return ["move", "velocity", "resize", "delete"];
}

/**
 * Screen positions for a body's contextual buttons, arranged around its center. Move sits ON the
 * body. Velocity sits at the live cursor while ITS handle is being dragged, otherwise at the end of
 * the velocity vector, or a fixed offset when velocity is zero. Resize sits at the live cursor
 * while ITS handle is being dragged, otherwise at a fixed offset to the left. Delete sits below.
 *
 * On the resize handle's live-drag behaviour — read this before "simplifying" it back:
 *
 * The original T-11 DRAFT decision was a FIXED COMPASS ARRANGEMENT for every button, chosen over
 * Godot's rim-distance formulas (LevelEditor.gd:237-262) and recorded here verbatim so it is not
 * lost: "a much simpler layout than Godot's rim-distance formulas — a fixed compass arrangement —
 * deliberately, since the exact rim geometry has no gameplay consequence and a predictable fixed
 * layout is easier for a mouse user to learn than one that moves with body size."
 *
 * The repo owner has overridden the RESIZE half of that: "the size selector button shall move to
 * the exact location where the cursor was dragged to (behave like the speed selector button).
 * Currently its fixed in place." Note what that does and does not contradict. The recorded
 * rationale argues against a handle whose RESTING position moves with body size; it says nothing
 * about a handle that follows the cursor during its own drag. So only the drag is overridden, and
 * the override has precedent in the reference the decision was measured against: Godot's own
 * `_button_screen_pos` gives "velocity" exactly this branch (`is_active` -> `world_to_screen(
 * _drag_world)`), and the velocity handle here has always had it via `liveVelocityEnd`.
 *
 * What still stands from the original decision, and is deliberately NOT changed here: the fixed
 * compass arrangement for move/delete and for velocity at rest; and no port of Godot's rim-distance
 * formulas (WEIGHT_BUTTON_DISTANCE_SCALE / SIZE_DRAG_SENSITIVITY).
 *
 * The resize handle's RESTING position has been through three designs and is worth recording so the
 * next reader does not re-derive them:
 *   1. Fixed compass offset (`center.x - BUTTON_SPACING`) — the original decision quoted above.
 *   2. "Stay exactly where the drag was released", remembered per body. SUPERSEDED before it was
 *      built: it needed a stable per-body identity, and `undo()` replaces the whole array with
 *      clones (`bodies = snap.bodies`), so every remembered offset would be silently orphaned.
 *   3. Polar: `RESIZE_REST_RADII` (3) times the body's DRAWN radius, in the direction of the screen
 *      centre. This is what the code below implements, chosen by the repo owner over (2) on
 *      2026-08-20. It is a pure function of `body`, `camera` and the drawn-size formulas, so there
 *      is no stored offset to orphan on undo, delete or reload, and a panel size edit moves the
 *      handle with no drag at all.
 *
 * Two consequences of (3) are known and accepted rather than designed around, and neither is a bug
 * to "fix" here:
 *   - Overshoot: a large body near the screen centre puts its handle PAST the centre. Explicitly
 *     fine per the owner; no clamp.
 *   - Release jump: the drag moves `size` at `SIZE_DRAG_SENSITIVITY = 0.1` per screen px, so the
 *     rest distance (3 x drawn radius) is not the drag distance and the handle snaps radially on
 *     release — inward by `1 - 3 * ratio * 0.1` of the drag, i.e. 70 % for a sun and 31 % for a
 *     planet. Reported to the owner before this landed.
 *   - The rotating handle can land on top of a fixed compass handle; `hitTestButtons` scans
 *     move -> velocity -> resize -> delete, so within 20 px of an earlier one the grab target for
 *     resize collapses to a sliver of its far edge. Known, owner's call, not worked around.
 *
 * The old comment also claimed resize "sits along the resize-drag axis", which the code never did.
 * That is now true, for the duration of the drag.
 */
export function buttonPositions(
  body: Body,
  camera: Camera,
  renderer: Pick<Renderer, "worldToScreen">,
  hovered: HandleName | null,
  liveVelocityEnd?: { x: number; y: number } | null,
  liveResizeEnd?: { x: number; y: number } | null,
): OverlayButton[] {
  const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
  const names = buttonNamesFor(body.type);
  const out: OverlayButton[] = [];
  for (const name of names) {
    let x: number;
    let y: number;
    switch (name) {
      case "move":
        x = center.x;
        y = center.y;
        break;
      case "velocity": {
        if (liveVelocityEnd) {
          x = liveVelocityEnd.x;
          y = liveVelocityEnd.y;
        } else if (body.xVel === 0 && body.yVel === 0) {
          x = center.x + BUTTON_SPACING;
          y = center.y;
        } else {
          const end = renderer.worldToScreen(
            { x: body.x + body.xVel * 100, y: body.y + body.yVel * 100 },
            camera,
          );
          x = end.x;
          y = end.y;
        }
        break;
      }
      case "resize":
        if (liveResizeEnd) {
          x = liveResizeEnd.x;
          y = liveResizeEnd.y;
        } else {
          const dir = resizeRestDirection(body, camera);
          const dist = RESIZE_REST_RADII * drawnRadiusPx(body, camera.zoom);
          x = center.x + dir.x * dist;
          y = center.y + dir.y * dist;
        }
        break;
      case "delete":
        x = center.x;
        y = center.y + BUTTON_SPACING;
        break;
    }
    out.push({ name, x, y, hovered: hovered === name });
  }
  return out;
}

/**
 * Unit vector from a body toward the centre of the screen — which in world terms is the camera
 * position, since `worldToScreen` maps `camera.x/y` to the viewport centre.
 *
 * This is the DIRECTION half of the resize handle's resting rule (repo owner: "rotated pointing at
 * the center of the screen"); the distance half is `RESIZE_REST_RADII * drawnRadiusPx(...)`. Both
 * are consumed by `buttonPositions` — see its doc comment for the full history.
 *
 * The world-space direction is used unchanged as a screen-space direction on purpose:
 * `worldToScreenXY` is `centre + (world - camera) * zoom` with no axis flip, so a world direction
 * and its screen direction differ only by the positive scalar `zoom`.
 *
 * The zero-length fallback is `(-1, 0)`, straight left: the same direction as today's compass
 * position and as Godot's `center + (-rim_radius, 0)`, so the degenerate case is continuous with
 * what is already on screen. It matters that this never returns `NaN`: a `NaN` button position
 * would NOT throw — `Math.sqrt(NaN) <= hitR` is simply false — so the handle would silently become
 * impossible to click rather than failing loudly. Both the zero case and denormal inputs that
 * underflow to zero when squared are covered.
 */
export function resizeRestDirection(
  body: { x: number; y: number },
  camera: Camera,
): { x: number; y: number } {
  const vx = camera.x - body.x;
  const vy = camera.y - body.y;
  const len = Math.sqrt(vx * vx + vy * vy);
  if (!(len > 0) || !Number.isFinite(len)) return { x: -1, y: 0 };
  const x = vx / len;
  const y = vy / len;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: -1, y: 0 };
  return { x, y };
}

export function hitTestButtons(
  buttons: readonly OverlayButton[],
  screenPt: { x: number; y: number },
  pad = 4,
): HandleName | null {
  const hitR = BUTTON_RADIUS + pad;
  for (const b of buttons) {
    const dx = b.x - screenPt.x;
    const dy = b.y - screenPt.y;
    if (Math.sqrt(dx * dx + dy * dy) <= hitR) return b.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paint pass
// ---------------------------------------------------------------------------

const GLYPH: Record<HandleName, string> = {
  move: "✥",
  velocity: "→",
  resize: "⤡",
  delete: "✕",
};

/** A minimal subset of CanvasRenderingContext2D — deliberately narrow so tests can pass a small
 *  fake implementing only this. */
export interface OverlayContext2D {
  save(): void;
  restore(): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  // Typed as the real `CanvasRenderingContext2D`'s property type (a union with CanvasGradient/
  // CanvasPattern), even though this module only ever assigns plain strings, so a real
  // `CanvasRenderingContext2D` is structurally assignable to this interface without a cast.
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
}

export function paintEditorOverlay(
  ctx: OverlayContext2D,
  overlay: EditorOverlay,
  bodies: readonly Body[],
  camera: Camera,
  renderer: Pick<Renderer, "worldToScreen">,
): void {
  ctx.save();

  // Gravity-influence rings — formula ported verbatim from LevelEditor.gd:630 (presentation-only).
  for (const body of bodies) {
    if (body.gravity <= 0) continue;
    const c = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    const r = Math.sqrt(body.gravity) * camera.zoom * 2.2;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,209,97,0.22)";
    ctx.lineWidth = Math.max(1, 1.5 * camera.zoom);
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Velocity arrows (non-sun bodies with a nonzero launch vector).
  for (const body of bodies) {
    if (body.type === "sun") continue;
    if (body.xVel === 0 && body.yVel === 0) continue;
    const start = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    const end = renderer.worldToScreen(
      { x: body.x + body.xVel * 100, y: body.y + body.yVel * 100 },
      camera,
    );
    ctx.beginPath();
    ctx.strokeStyle =
      body.type === "player" ? "rgba(250,97,97,0.8)" : "rgba(97,166,250,0.8)";
    ctx.lineWidth = Math.max(1.5, 2 * camera.zoom);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  // Hover / selection ring.
  const ringIndex =
    overlay.selectedIndex >= 0 ? overlay.selectedIndex : overlay.hoverIndex;
  if (ringIndex >= 0 && ringIndex < bodies.length && !overlay.phantom) {
    const body = bodies[ringIndex]!;
    const c = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    const r = hoverRadiusPx(body, camera.zoom);
    ctx.beginPath();
    ctx.strokeStyle = "rgba(184,240,255,0.35)";
    ctx.lineWidth = 2;
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (overlay.requiresReset) {
      ctx.fillStyle = "rgba(245,209,122,0.96)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("reset stage to edit", c.x, c.y - 44);
    }
  }

  // Contextual buttons for the selected object.
  if (!overlay.requiresReset) {
    for (const b of overlay.buttons) {
      ctx.beginPath();
      ctx.fillStyle = b.hovered ? "rgba(15,23,43,0.90)" : "rgba(15,23,43,0.72)";
      ctx.arc(b.x, b.y, BUTTON_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = b.hovered
        ? "rgba(235,250,255,0.95)"
        : "rgba(166,209,255,0.65)";
      ctx.lineWidth = b.hovered ? 1.8 : 1.1;
      ctx.arc(b.x, b.y, BUTTON_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = b.hovered
        ? "rgba(235,250,255,0.95)"
        : "rgba(166,209,255,0.75)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(GLYPH[b.name], b.x, b.y);
    }
  }

  // Placement ghost.
  if (overlay.phantom) {
    const c = renderer.worldToScreen(
      { x: overlay.phantom.x, y: overlay.phantom.y },
      camera,
    );
    const r =
      overlay.phantom.type === "sun"
        ? 18
        : overlay.phantom.type === "player"
          ? 14
          : 10;
    ctx.beginPath();
    ctx.fillStyle = "rgba(184,240,255,0.24)";
    ctx.arc(c.x, c.y, Math.max(6, r * camera.zoom), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(184,240,255,0.65)";
    ctx.lineWidth = 2;
    ctx.arc(c.x, c.y, Math.max(6, r * camera.zoom), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
