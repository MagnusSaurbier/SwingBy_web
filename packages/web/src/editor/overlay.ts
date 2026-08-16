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

import type { Body, BodyType } from "@swingby/core/types";
import type { Camera, Renderer } from "../render/index.js";

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

/** On-screen hit/hover radius for a body, proportional to its actual rendered size. */
export function hoverRadiusPx(body: { size: number }, zoom: number): number {
  return Math.max(body.size * zoom + 10, MIN_HIT_RADIUS);
}

/** Which contextual buttons a body type has. Suns never get a velocity handle (they're stationary
 *  gravity sources) — mirrors `_contextual_circle_button_names` (LevelEditor.gd:227-234). */
export function buttonNamesFor(type: BodyType): readonly HandleName[] {
  return type === "sun" ? ["move", "resize", "delete"] : ["move", "velocity", "resize", "delete"];
}

/**
 * Screen positions for a body's contextual buttons, arranged around its center. Move sits ON the
 * body; velocity sits along the (possibly live-dragged) velocity vector, or a fixed offset when
 * velocity is zero; resize sits along the resize-drag axis; delete sits below. This is a much
 * simpler layout than Godot's rim-distance formulas (LevelEditor.gd:237-262) — a fixed compass
 * arrangement — deliberately, since the exact rim geometry has no gameplay consequence and a
 * predictable fixed layout is easier for a mouse user to learn than one that moves with body size.
 */
export function buttonPositions(
  body: Body,
  camera: Camera,
  renderer: Pick<Renderer, "worldToScreen">,
  hovered: HandleName | null,
  liveVelocityEnd?: { x: number; y: number } | null,
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
        x = center.x - BUTTON_SPACING;
        y = center.y;
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
  strokeStyle: string;
  fillStyle: string;
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
    const end = renderer.worldToScreen({ x: body.x + body.xVel * 100, y: body.y + body.yVel * 100 }, camera);
    ctx.beginPath();
    ctx.strokeStyle = body.type === "player" ? "rgba(250,97,97,0.8)" : "rgba(97,166,250,0.8)";
    ctx.lineWidth = Math.max(1.5, 2 * camera.zoom);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  // Hover / selection ring.
  const ringIndex = overlay.selectedIndex >= 0 ? overlay.selectedIndex : overlay.hoverIndex;
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
      ctx.strokeStyle = b.hovered ? "rgba(235,250,255,0.95)" : "rgba(166,209,255,0.65)";
      ctx.lineWidth = b.hovered ? 1.8 : 1.1;
      ctx.arc(b.x, b.y, BUTTON_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = b.hovered ? "rgba(235,250,255,0.95)" : "rgba(166,209,255,0.75)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(GLYPH[b.name], b.x, b.y);
    }
  }

  // Placement ghost.
  if (overlay.phantom) {
    const c = renderer.worldToScreen({ x: overlay.phantom.x, y: overlay.phantom.y }, camera);
    const r = overlay.phantom.type === "sun" ? 18 : overlay.phantom.type === "player" ? 14 : 10;
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
