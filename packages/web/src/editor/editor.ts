/**
 * T-11 DRAFT — deliverable 1: the editor controller. Two layers, the same shape as T-05's own
 * `createGameLoop`/`createSession` split (see notes/T-11-DRAFT/log.md decision #1):
 *
 *   - `createEditorEngine(opts)` — headless-testable core: authored body/goal state, hit-testing
 *     (via an injected `{worldToScreen, screenToWorld}`, real or fake), placement, dragging, undo,
 *     save/validate, and the preview-gate flag. No DOM dependency at all.
 *   - `mountEditor(opts)` — real DOM: toolbar, canvas, panel, dialogs, pointer/wheel/keyboard
 *     listeners, and the rAF loop that drives either the engine's own redraw (edit mode) or the
 *     preview controller's `frame(dt)` (preview mode). Verified via a real headless-Chromium
 *     screenshot pass, not unit tests — same split T-04/T-05 used for the same reason.
 *
 * `EditorOverlay` (deliverable 4, `overlay.ts`) is populated into a `RenderFrame` this module builds
 * itself for its OWN `createRenderer` instance during edit mode — `render/index.ts` never has to
 * change, and never reads that field (confirmed by reading its source: `draw()` destructures
 * `frame` and never touches `editorOverlay`). The actual overlay paint (rings/buttons/ghost) happens
 * via `overlay.ts`'s `paintEditorOverlay`, called right after `renderer.draw()` on the same canvas's
 * 2D context (`getContext("2d")` is idempotent — same context object every call).
 */

import type { Body, BodyType, Level, Settings, World } from "@swingby/core";
import {
  hydrate,
  serialize,
  validate,
  DEFAULT_BODY_SIZE,
  GOAL_RANGE_DEFAULT,
} from "@swingby/core";
import type { Storage } from "../storage/index.js";
import type { Api } from "../net/index.js";
import {
  createRenderer,
  type Camera,
  type Renderer,
  type RenderFrame,
} from "../render/index.js";
import {
  createEditorCamera,
  fitCamera,
  panByScreenDelta,
  zoomAtScreenPoint,
  type EditorCamera,
  type ViewportSize,
} from "./viewport.js";
import {
  buttonPositions,
  hitTestButtons,
  hoverRadiusPx,
  paintEditorOverlay,
  type EditorOverlay,
  type HandleName,
  type OverlayButton,
  type PhantomGhost,
} from "./overlay.js";
import { UndoStack } from "./history.js";
import { createPreviewController, type PreviewController } from "./preview.js";
import { mountPanel, type PanelState } from "./panel.js";
import { confirmDialog, showErrorsDialog, showMessageDialog, showShareLinkDialog } from "./dialogs.js";

// ---------------------------------------------------------------------------
// Pure math helpers — never Math.pow (repo-wide rule; also never touches the physics path here,
// this is editor authoring math only, but keeping the same discipline costs nothing).
// ---------------------------------------------------------------------------

const SIZE_TO_GRAVITY_SCALE = 1000.0 / (18.0 * 18.0 * 18.0); // size=18 -> gravity=1000, LevelEditor.gd:27

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampIndexInto(idx: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(idx, 0), length - 1);
}

function clampIndexOrNeg(idx: number, length: number): number {
  if (idx < 0) return -1;
  return length <= 0 ? -1 : Math.min(idx, length - 1);
}

function cloneBodies(bodies: readonly Body[]): Body[] {
  return bodies.map((b) => ({ ...b }));
}

function makeDefaultBody(type: BodyType, x: number, y: number): Body {
  return {
    type,
    x,
    y,
    xVel: 0,
    yVel: 0,
    xAcc: 0,
    yAcc: 0,
    gravity: type === "sun" ? 1000 : 0,
    size: type === "sun" ? 18 : DEFAULT_BODY_SIZE,
    visible: true,
    anchored: false,
    angle: 0,
    turnSpeed: 0,
    isBoosting: false,
    isBraking: false,
    boostType: 0,
  };
}

interface EditableSnapshot {
  bodies: Body[];
  goalIndex: number;
  goalRange: number;
}

function cloneSnapshot(s: EditableSnapshot): EditableSnapshot {
  return {
    bodies: cloneBodies(s.bodies),
    goalIndex: s.goalIndex,
    goalRange: s.goalRange,
  };
}

// ---------------------------------------------------------------------------
// EditorEngine — the headless-testable core
// ---------------------------------------------------------------------------

export interface EditorTransforms {
  worldToScreen(
    p: { x: number; y: number },
    camera: Camera,
  ): { x: number; y: number };
  screenToWorld(
    p: { x: number; y: number },
    camera: Camera,
  ): { x: number; y: number };
}

export interface EditorEngineOptions {
  renderer: EditorTransforms;
  viewport: ViewportSize;
  initialLevel?: Level;
  defaultAuthor?: string;
}

export interface EditorEngine {
  // -- reads --
  getBodies(): readonly Body[];
  getSelectedIndex(): number;
  getSelectedBody(): Body | null;
  getHoverIndex(): number;
  getGoalIndex(): number;
  getGoalRange(): number;
  getMeta(): { name: string; author: string };
  getCamera(): EditorCamera;
  getPlaceType(): BodyType | null;
  isDragging(): boolean;
  canUndo(): boolean;
  undoDepth(): number;
  requiresReset(): boolean;
  getOverlay(): EditorOverlay;
  /** Pure hit-test query (no side effects) — which body index, if any, sits under `screenPt` at the
   *  current camera. Used both by the pointer-gesture handlers below and directly by tests to prove
   *  selection accuracy across zoom levels without triggering a drag as a side effect. Uses the
   *  REAL injected `renderer.worldToScreen` — never a re-derived transform (task doc: "Hit-testing
   *  uses T-04's worldToScreen/screenToWorld... rely on that as exact inverses"). */
  hitTest(screenPt: { x: number; y: number }): number;
  toLevel(): Level;
  validateCurrent(): { ok: true } | { ok: false; errors: string[] };

  // -- camera / viewport --
  setViewport(v: ViewportSize): void;
  zoomAt(steps: number, screenPt: { x: number; y: number }): void;
  fitToContent(): void;

  // -- tools / pointer gesture --
  armPlace(type: BodyType): void;
  cancelPlace(): void;
  pointerDown(screenPt: { x: number; y: number }): void;
  pointerMove(screenPt: { x: number; y: number }): void;
  pointerUp(screenPt: { x: number; y: number }): void;

  // -- direct field edits (panel) --
  setSelectedVelocity(vx: number, vy: number): void;
  setSelectedGravity(v: number): void;
  setSelectedSize(v: number): void;
  setSelectedVisible(v: boolean): void;
  setSelectedAnchored(v: boolean): void;
  setSelectedAsGoal(): void;
  setGoalRange(v: number): void;
  setMeta(name: string, author: string): void;
  select(index: number): void;
  deleteAt(index: number): void;
  deleteSelected(): void;

  // -- bulk --
  undo(): boolean;
  clear(): void;

  // -- preview gate --
  setPreviewGate(active: boolean): void;
}

export function createEditorEngine(opts: EditorEngineOptions): EditorEngine {
  const renderer = opts.renderer;
  let viewport = opts.viewport;

  let bodies: Body[];
  let goalIndex: number;
  let goalRange: number;
  let name: string;
  let author: string;

  if (opts.initialLevel) {
    const world: World = hydrate(opts.initialLevel);
    bodies = cloneBodies(world.bodies);
    goalIndex = world.goalIndex;
    goalRange = world.goalRange;
    name = opts.initialLevel.name;
    author = opts.initialLevel.author;
  } else {
    bodies = [];
    goalIndex = 0;
    goalRange = GOAL_RANGE_DEFAULT;
    name = "Custom Stage";
    author = opts.defaultAuthor ?? "Guest";
  }

  let camera: EditorCamera = fitCamera(
    bodies.map((b) => ({ x: b.x, y: b.y })),
    viewport,
  );

  let selectedIndex = -1;
  let hoverIndex = -1;
  let hoveredButton: HandleName | null = null;
  let placeType: BodyType | null = null;
  let phantom: PhantomGhost | null = null;

  type Gesture = "none" | "drag" | "place" | "pan";
  let gesture: Gesture = "none";
  let dragHandle: HandleName | null = null;
  let moveGrabOffset = { x: 0, y: 0 };
  let resizeAnchor = { x: 0, y: 0 };
  let resizeGrabDist = -1;
  let resizeStartSize = 0;
  let historyPushedThisGesture = false;
  let panStart = { x: 0, y: 0 };
  let panLast = { x: 0, y: 0 };
  let panMoved = false;

  let previewGate = false;

  const history = new UndoStack<EditableSnapshot>(cloneSnapshot);

  function gated(): boolean {
    return previewGate;
  }

  function pushHistory(): void {
    history.push({ bodies: cloneBodies(bodies), goalIndex, goalRange });
  }

  function pickObjectAt(screenPt: { x: number; y: number }): number {
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i]!;
      const s = renderer.worldToScreen({ x: b.x, y: b.y }, camera);
      const dx = s.x - screenPt.x;
      const dy = s.y - screenPt.y;
      if (Math.sqrt(dx * dx + dy * dy) <= hoverRadiusPx(b, camera.zoom))
        return i;
    }
    return -1;
  }

  function currentButtons(): OverlayButton[] {
    if (selectedIndex < 0 || selectedIndex >= bodies.length) return [];
    const b = bodies[selectedIndex]!;
    let liveEnd: { x: number; y: number } | null = null;
    if (gesture === "drag" && dragHandle === "velocity") {
      liveEnd = renderer.worldToScreen(
        { x: b.x + b.xVel * 100, y: b.y + b.yVel * 100 },
        camera,
      );
    }
    return buttonPositions(b, camera, renderer, hoveredButton, liveEnd);
  }

  function beginDrag(
    index: number,
    handle: HandleName,
    worldPt: { x: number; y: number },
  ): void {
    gesture = "drag";
    dragHandle = handle;
    historyPushedThisGesture = false;
    const b = bodies[index]!;
    resizeAnchor = { x: b.x, y: b.y };
    moveGrabOffset = { x: b.x - worldPt.x, y: b.y - worldPt.y };
    resizeGrabDist = -1;
  }

  function applyDrag(worldPt: { x: number; y: number }): void {
    if (dragHandle === null || selectedIndex < 0) return;
    const b = bodies[selectedIndex];
    if (!b) return;
    if (!historyPushedThisGesture) {
      pushHistory();
      historyPushedThisGesture = true;
    }
    switch (dragHandle) {
      case "move":
        b.x = worldPt.x + moveGrabOffset.x;
        b.y = worldPt.y + moveGrabOffset.y;
        break;
      case "velocity":
        if (b.type !== "sun") {
          b.xVel = (worldPt.x - b.x) * 0.01;
          b.yVel = (worldPt.y - b.y) * 0.01;
        }
        break;
      case "resize": {
        const dNow = Math.sqrt(
          (worldPt.x - resizeAnchor.x) ** 2 + (worldPt.y - resizeAnchor.y) ** 2,
        );
        if (resizeGrabDist < 0) {
          resizeGrabDist = dNow;
          resizeStartSize = b.size;
        }
        const newSize = clampNum(
          resizeStartSize + 0.1 * (dNow - resizeGrabDist),
          4,
          40,
        );
        b.size = newSize;
        // Non-player only — see notes/T-11-DRAFT/log.md decision #6.
        if (b.type !== "player") {
          b.gravity = newSize * newSize * newSize * SIZE_TO_GRAVITY_SCALE;
        }
        break;
      }
      case "delete":
        break;
    }
  }

  function commitPlacement(): void {
    if (!phantom) return;
    pushHistory();
    const body = makeDefaultBody(phantom.type, phantom.x, phantom.y);
    bodies.push(body);
    selectedIndex = bodies.length - 1;
    goalIndex = clampIndexInto(goalIndex, bodies.length);
    placeType = null;
    phantom = null;
  }

  return {
    getBodies: () => bodies,
    getSelectedIndex: () => selectedIndex,
    getSelectedBody: () =>
      selectedIndex >= 0 && selectedIndex < bodies.length
        ? bodies[selectedIndex]!
        : null,
    getHoverIndex: () => hoverIndex,
    getGoalIndex: () => goalIndex,
    getGoalRange: () => goalRange,
    getMeta: () => ({ name, author }),
    getCamera: () => camera,
    getPlaceType: () => placeType,
    isDragging: () => gesture === "drag",
    canUndo: () => history.canUndo(),
    undoDepth: () => history.depth(),
    requiresReset: () => previewGate,
    hitTest: (screenPt) => pickObjectAt(screenPt),

    getOverlay(): EditorOverlay {
      return {
        tool: placeType ? "place" : "select",
        placeType,
        selectedIndex,
        hoverIndex,
        phantom,
        dragging:
          gesture === "drag" && dragHandle
            ? { index: selectedIndex, handle: dragHandle }
            : null,
        requiresReset: previewGate,
        buttons: gated() ? [] : currentButtons(),
        goalIndex,
      };
    },

    toLevel(): Level {
      const playerIndex = bodies.findIndex((b) => b.type === "player");
      const world: World = {
        bodies: cloneBodies(bodies),
        playerIndex,
        goalIndex,
        goalRange,
      };
      const trimmedName = name.trim();
      const trimmedAuthor = author.trim();
      return serialize(world, {
        name: trimmedName.length > 0 ? trimmedName : "Custom Stage",
        author: trimmedAuthor.length > 0 ? trimmedAuthor : "Guest",
      });
    },

    validateCurrent() {
      return validate(this.toLevel());
    },

    setViewport(v: ViewportSize): void {
      viewport = v;
    },

    zoomAt(steps: number, screenPt: { x: number; y: number }): void {
      zoomAtScreenPoint(camera, steps, screenPt, viewport);
    },

    fitToContent(): void {
      camera = fitCamera(
        bodies.map((b) => ({ x: b.x, y: b.y })),
        viewport,
      );
    },

    armPlace(type: BodyType): void {
      if (gated()) return;
      placeType = type;
      selectedIndex = -1;
      gesture = "none";
      phantom = null;
    },

    cancelPlace(): void {
      placeType = null;
      phantom = null;
      if (gesture === "place") gesture = "none";
    },

    pointerDown(screenPt: { x: number; y: number }): void {
      if (gated()) return;
      const worldPt = renderer.screenToWorld(screenPt, camera);
      if (placeType) {
        gesture = "place";
        phantom = { type: placeType, x: worldPt.x, y: worldPt.y };
        return;
      }
      if (selectedIndex >= 0 && selectedIndex < bodies.length) {
        const btn = hitTestButtons(currentButtons(), screenPt);
        if (btn === "delete") {
          this.deleteAt(selectedIndex);
          gesture = "none";
          return;
        }
        if (btn) {
          beginDrag(selectedIndex, btn, worldPt);
          return;
        }
      }
      const idx = pickObjectAt(screenPt);
      if (idx >= 0) {
        selectedIndex = idx;
        beginDrag(idx, "move", worldPt);
        return;
      }
      selectedIndex = -1;
      gesture = "pan";
      panStart = screenPt;
      panLast = screenPt;
      panMoved = false;
    },

    pointerMove(screenPt: { x: number; y: number }): void {
      if (gated()) return;
      const worldPt = renderer.screenToWorld(screenPt, camera);
      switch (gesture) {
        case "place":
          if (phantom) phantom = { ...phantom, x: worldPt.x, y: worldPt.y };
          hoverIndex = -1;
          break;
        case "drag":
          applyDrag(worldPt);
          break;
        case "pan": {
          const dx = screenPt.x - panStart.x;
          const dy = screenPt.y - panStart.y;
          if (Math.sqrt(dx * dx + dy * dy) > 5) panMoved = true;
          if (panMoved) {
            panByScreenDelta(
              camera,
              screenPt.x - panLast.x,
              screenPt.y - panLast.y,
            );
            panLast = screenPt;
          }
          break;
        }
        case "none":
          hoverIndex = pickObjectAt(screenPt);
          hoveredButton =
            selectedIndex >= 0
              ? hitTestButtons(currentButtons(), screenPt)
              : null;
          break;
      }
    },

    pointerUp(_screenPt: { x: number; y: number }): void {
      if (gated()) {
        gesture = "none";
        return;
      }
      if (gesture === "place") {
        commitPlacement();
      } else if (gesture === "drag") {
        resizeGrabDist = -1;
        dragHandle = null;
      }
      gesture = "none";
    },

    setSelectedVelocity(vx: number, vy: number): void {
      if (gated() || selectedIndex < 0) return;
      const b = bodies[selectedIndex];
      if (!b || b.type === "sun") return;
      pushHistory();
      b.xVel = vx;
      b.yVel = vy;
    },

    setSelectedGravity(v: number): void {
      if (gated() || selectedIndex < 0) return;
      const b = bodies[selectedIndex];
      if (!b) return;
      pushHistory();
      b.gravity = Math.max(0, v);
    },

    setSelectedSize(v: number): void {
      if (gated() || selectedIndex < 0) return;
      const b = bodies[selectedIndex];
      if (!b) return;
      pushHistory();
      const clamped = clampNum(v, 4, 40);
      b.size = clamped;
      if (b.type !== "player") {
        b.gravity = clamped * clamped * clamped * SIZE_TO_GRAVITY_SCALE;
      }
    },

    setSelectedVisible(v: boolean): void {
      if (gated() || selectedIndex < 0) return;
      const b = bodies[selectedIndex];
      if (!b || b.type !== "sun") return;
      pushHistory();
      b.visible = v;
    },

    setSelectedAnchored(v: boolean): void {
      if (gated() || selectedIndex < 0) return;
      const b = bodies[selectedIndex];
      if (!b || b.type !== "planet") return;
      pushHistory();
      b.anchored = v;
    },

    setSelectedAsGoal(): void {
      if (gated() || selectedIndex < 0 || selectedIndex >= bodies.length)
        return;
      pushHistory();
      goalIndex = selectedIndex;
    },

    setGoalRange(v: number): void {
      if (gated()) return;
      pushHistory();
      goalRange = v;
    },

    setMeta(nextName: string, nextAuthor: string): void {
      name = nextName;
      author = nextAuthor;
    },

    select(index: number): void {
      if (gated()) return;
      selectedIndex = clampIndexOrNeg(index, bodies.length);
    },

    deleteAt(index: number): void {
      if (gated()) return;
      if (index < 0 || index >= bodies.length) return;
      pushHistory();
      bodies.splice(index, 1);
      if (goalIndex > index) goalIndex--;
      else if (goalIndex === index)
        goalIndex = clampIndexInto(goalIndex, bodies.length);
      if (selectedIndex === index) selectedIndex = -1;
      else if (selectedIndex > index) selectedIndex--;
      if (hoverIndex === index) hoverIndex = -1;
      else if (hoverIndex > index) hoverIndex--;
    },

    deleteSelected(): void {
      this.deleteAt(selectedIndex);
    },

    undo(): boolean {
      if (gated()) return false;
      const snap = history.pop();
      if (!snap) return false;
      bodies = snap.bodies;
      goalIndex = snap.goalIndex;
      goalRange = snap.goalRange;
      selectedIndex = clampIndexOrNeg(selectedIndex, bodies.length);
      hoverIndex = clampIndexOrNeg(hoverIndex, bodies.length);
      return true;
    },

    clear(): void {
      if (gated()) return;
      pushHistory();
      bodies = [];
      goalIndex = 0;
      goalRange = GOAL_RANGE_DEFAULT;
      selectedIndex = -1;
      hoverIndex = -1;
    },

    setPreviewGate(active: boolean): void {
      previewGate = active;
      if (active) {
        gesture = "none";
        hoveredButton = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// mountEditor — the DOM-wiring layer
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return node;
}

// ---------------------------------------------------------------------------
// Share — follow-up wiring to T-13 PODIUM's `Api.shareLevel`. `shareLevelFlow` below is the whole
// orchestration, deliberately factored out as a plain async function with INJECTED dependencies
// (not a closure inside `mountEditor`) — same "headless-testable core, thin DOM adapter" split the
// rest of this file already uses for `createEditorEngine` vs. `mountEditor` (see the top doc
// comment), applied here so this specific follow-up's three required properties are each covered
// by a real, DOM-free `editor-share.test.ts` test, not just documented:
//
//   1. `validate()` first, exactly like Save — an invalid level is never sent anywhere, checked
//      via `deps.validateLevel` (the real `validate` in production, a controllable fake in tests).
//   2. `deps.saveLocally(level)` (T-10's `storage.saveCustomLevel`, synchronous) runs BEFORE the
//      network call, and `deps.onSavedLocally` fires immediately after it succeeds — so "the level
//      must already be saved locally before any network call happens" is a property of the
//      function's own control flow (provably: `saveLocally` is `await`ed... it isn't even async,
//      it's a plain synchronous call that must complete or throw before the next line runs) and
//      not a race that merely usually wins.
//   3. `deps.shareLevel(level)` is awaited inside `withTimeout` so a share NEVER stays pending
//      forever regardless of what a given `Api` implementation does — T-13's own `requestJson` has
//      its own ~4s internal timeout already (results/T-13-PODIUM.md), so this is defense in depth,
//      not the only guarantee; it also makes "a hanging share still resolves and shows an error"
//      independently testable with a fake `Api.shareLevel` that never resolves at all.
//   4. The resolved value is treated as hostile remote data — `sanitizeShareResult` re-checks its
//      shape and URL scheme even though `net/validate.ts`'s `parseShareResponse` already validated
//      it server-response-side; the DOM adapter (`mountEditor`'s `handleShare`) renders the result
//      exclusively via a readonly `<input>`'s `value` (dialogs.ts's `showShareLinkDialog`), never
//      `innerHTML`, never a live clickable `<a href>`.
// ---------------------------------------------------------------------------

export const SHARE_CLIENT_TIMEOUT_MS = 6000;

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Never trust a network response's shape, even one `Api.shareLevel` already claims to have
 *  validated (defense in depth — see the module doc comment above). Exported for direct unit
 *  testing of every hostile-shape case. */
export function sanitizeShareResult(value: unknown): { id: string; url: string } | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0 || v.id.length > 200) return null;
  if (typeof v.url !== "string" || v.url.length === 0 || v.url.length > 2000) return null;
  try {
    const parsed = new URL(v.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null; // not a well-formed absolute URL at all
  }
  return { id: v.id, url: v.url };
}

export function describeError(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export interface ShareDeps {
  validateLevel: (level: Level) => { ok: true } | { ok: false; errors: string[] };
  /** T-10's `storage.saveCustomLevel` in production — synchronous, may throw (e.g. quota). */
  saveLocally: (level: Level) => void;
  /** Fires exactly once, synchronously after `saveLocally` returns without throwing — BEFORE
   *  `shareLevel` is ever called. This is the hook tests use to prove save-then-network ordering. */
  onSavedLocally?: (level: Level) => void;
  /** T-13's `Api.shareLevel` in production. */
  shareLevel: (level: Level) => Promise<unknown>;
  timeoutMs?: number;
}

export type ShareOutcome =
  | { kind: "invalid"; errors: string[] }
  | { kind: "save-failed"; message: string }
  | { kind: "shared"; id: string; url: string }
  | { kind: "share-failed"; message: string };

/**
 * The whole Share orchestration, DOM-free. Never throws — every failure path resolves to a
 * `ShareOutcome` variant instead, so a caller (the DOM adapter, or a test) never needs a try/catch
 * of its own around this function.
 */
export async function shareLevelFlow(level: Level, deps: ShareDeps): Promise<ShareOutcome> {
  const validation = deps.validateLevel(level);
  if (!validation.ok) return { kind: "invalid", errors: validation.errors };

  try {
    deps.saveLocally(level);
  } catch (err) {
    return { kind: "save-failed", message: describeError(err) };
  }
  deps.onSavedLocally?.(level);

  try {
    const raw = await withTimeout(
      deps.shareLevel(level),
      deps.timeoutMs ?? SHARE_CLIENT_TIMEOUT_MS,
      "Share",
    );
    const safe = sanitizeShareResult(raw);
    if (!safe) {
      return { kind: "share-failed", message: "The server returned an unexpected response." };
    }
    return { kind: "shared", id: safe.id, url: safe.url };
  } catch (err) {
    return { kind: "share-failed", message: describeError(err) };
  }
}

export interface EditorMountOptions {
  storage: Storage;
  level?: Level;
  onExit?: () => void;
  onSaved?: (level: Level) => void;
  /**
   * Optional — T-13 PODIUM's `Api`, needed only for the Share action (`shareLevel`). Optional
   * (not required) specifically so the already-landed `ui/screens/editorPlaceholder.ts` call site
   * (`mountEditor({ storage, onExit, onSaved })`, no `api`) keeps compiling unchanged; the Share
   * button simply does not render until a caller passes one. See results/T-11-DRAFT.md's "Follow-
   * ups" section for the one-line `ui/` change that turns it on for real (`api: ctx.api`).
   */
  api?: Api;
}

export interface EditorHandle {
  el: HTMLElement;
  destroy(): void;
}

export function mountEditor(opts: EditorMountOptions): EditorHandle {
  const root = el("main", { class: "screen editor-screen" });

  const toolbar = el("div", { class: "panel editor-toolbar control-row" });
  const canvasWrap = el("div", {
    class: "play-canvas-wrap editor-canvas-wrap",
  });
  const canvas = el("canvas", { class: "play-canvas editor-canvas" });
  const touchNote = el("p", { class: "editor-touch-note dialog-sub" }, [
    "Desktop / mouse only — touch input is not supported in the editor.",
  ]);
  canvasWrap.append(canvas, touchNote);

  const panel = mountPanel({
    onSetVelocity: (vx, vy) => {
      engine.setSelectedVelocity(vx, vy);
      refreshPanel();
    },
    onSetGravity: (v) => {
      engine.setSelectedGravity(v);
      refreshPanel();
    },
    onSetSize: (v) => {
      engine.setSelectedSize(v);
      refreshPanel();
    },
    onSetVisible: (v) => {
      engine.setSelectedVisible(v);
      refreshPanel();
    },
    onSetAnchored: (v) => {
      engine.setSelectedAnchored(v);
      refreshPanel();
    },
    onSetAsGoal: () => {
      engine.setSelectedAsGoal();
      refreshPanel();
    },
    onSetGoalRange: (v) => {
      engine.setGoalRange(v);
      refreshPanel();
    },
    onDelete: () => {
      engine.deleteSelected();
      refreshPanel();
    },
    onSetMeta: (n, a) => {
      engine.setMeta(n, a);
      refreshPanel();
    },
  });

  const body = el("div", { class: "editor-body" }, [canvasWrap, panel.el]);
  root.append(toolbar, body);

  // -- renderer + engine ------------------------------------------------------------------------
  const editRenderer: Renderer = createRenderer(canvas);
  const viewport: ViewportSize = { width: 960, height: 600 };
  const engine = createEditorEngine({
    renderer: editRenderer,
    viewport,
    initialLevel: opts.level,
    defaultAuthor: opts.storage.getSettings().username,
  });

  function refreshPanel(): void {
    const selected = engine.getSelectedBody();
    const meta = engine.getMeta();
    const state: PanelState = {
      selected,
      selectedIndex: engine.getSelectedIndex(),
      isGoal:
        engine.getSelectedIndex() === engine.getGoalIndex() &&
        engine.getSelectedIndex() >= 0,
      goalRange: engine.getGoalRange(),
      name: meta.name,
      author: meta.author,
      requiresReset: engine.requiresReset(),
      bodyCount: engine.getBodies().length,
    };
    panel.update(state);
  }
  refreshPanel();

  // -- toolbar ------------------------------------------------------------------------------------
  function toolButton(
    label: string,
    onClick: () => void,
    extraClass = "btn-ghost",
  ): HTMLButtonElement {
    const btn = el("button", { type: "button", class: `btn ${extraClass}` }, [
      label,
    ]);
    btn.addEventListener("click", onClick);
    return btn;
  }

  let previewMode: "edit" | "preview" = "edit";
  let preview: PreviewController | null = null;

  const placePlayerBtn = toolButton("Place player", () => {
    engine.armPlace("player");
  });
  const placeSunBtn = toolButton("Place sun", () => {
    engine.armPlace("sun");
  });
  const placePlanetBtn = toolButton("Place planet", () => {
    engine.armPlace("planet");
  });
  const undoBtn = toolButton("Undo", () => {
    engine.undo();
    refreshPanel();
  });
  const clearBtn = toolButton(
    "Clear stage",
    () => {
      void confirmDialog(root, {
        title: "Clear stage?",
        body: "Every object on the stage will be removed. This can be undone once via Undo.",
        confirmLabel: "Clear",
        danger: true,
      }).then((confirmed) => {
        if (confirmed) {
          engine.clear();
          refreshPanel();
        }
      });
    },
    "btn-ghost",
  );
  const playBtn = toolButton("Play preview", () => enterPreview());
  const pauseBtn = toolButton("Pause preview", () => preview?.pause());
  const resetPreviewBtn = toolButton("Reset preview", () => resetPreview());
  const saveBtn = toolButton(
    "Save",
    () => {
      void confirmDialog(root, {
        title: "Save level?",
        body: "Saves a new custom level to this browser's storage.",
        confirmLabel: "Save",
      }).then((confirmed) => {
        if (!confirmed) return;
        const level = engine.toLevel();
        const result = validate(level);
        if (!result.ok) {
          void showErrorsDialog(
            root,
            "Can't save this level yet",
            result.errors,
          );
          return;
        }
        opts.storage.saveCustomLevel(level);
        opts.onSaved?.(level);
      });
    },
    "btn-primary",
  );

  // Share — only created/appended when a caller passed `api` (see EditorMountOptions.api's doc
  // comment: optional so the already-landed ui/ call site keeps compiling unchanged).
  let shareBusy = false;
  const shareBtn = opts.api ? toolButton("Share", () => void handleShare(), "btn-ghost") : null;

  // Thin DOM adapter over the headless `shareLevelFlow` — see that function's doc comment for the
  // three properties it guarantees (validate-first, save-before-network, timeout-bounded). This
  // function's only job is: show the busy state, call the real orchestration, translate the
  // resulting `ShareOutcome` into the right dialog.
  async function handleShare(): Promise<void> {
    const api = opts.api;
    if (!api || shareBusy) return;

    const level = engine.toLevel();
    shareBusy = true;
    if (shareBtn) {
      shareBtn.textContent = "Sharing…";
      shareBtn.toggleAttribute("disabled", true);
    }

    const outcome = await shareLevelFlow(level, {
      validateLevel: validate,
      saveLocally: (l) => opts.storage.saveCustomLevel(l),
      onSavedLocally: (l) => opts.onSaved?.(l),
      shareLevel: (l) => api.shareLevel(l),
    });

    shareBusy = false;
    if (shareBtn) shareBtn.textContent = "Share";
    updateToolbarState();

    switch (outcome.kind) {
      case "invalid":
        void showErrorsDialog(root, "Can't share this level yet", outcome.errors);
        break;
      case "save-failed":
        void showMessageDialog(root, "Couldn't save this level", outcome.message);
        break;
      case "share-failed":
        void showMessageDialog(root, "Share failed", outcome.message);
        break;
      case "shared":
        void showShareLinkDialog(root, outcome.url);
        break;
    }
  }

  const backBtn = toolButton(
    "Back",
    () => {
      void confirmDialog(root, {
        title: "Leave the editor?",
        body: "Unsaved changes will be lost.",
        confirmLabel: "Leave",
        danger: true,
      }).then((confirmed) => {
        if (confirmed) opts.onExit?.();
      });
    },
    "btn-ghost",
  );

  function updateToolbarState(): void {
    undoBtn.toggleAttribute(
      "disabled",
      !engine.canUndo() || previewMode === "preview",
    );
    playBtn.style.display = previewMode === "edit" ? "" : "none";
    pauseBtn.style.display = previewMode === "preview" ? "" : "none";
    resetPreviewBtn.style.display = previewMode === "preview" ? "" : "none";
    for (const b of [
      placePlayerBtn,
      placeSunBtn,
      placePlanetBtn,
      clearBtn,
      saveBtn,
    ]) {
      b.toggleAttribute("disabled", previewMode === "preview");
    }
    if (shareBtn) {
      shareBtn.toggleAttribute("disabled", previewMode === "preview" || shareBusy);
    }
  }
  updateToolbarState();

  toolbar.append(
    placePlayerBtn,
    placeSunBtn,
    placePlanetBtn,
    undoBtn,
    clearBtn,
    playBtn,
    pauseBtn,
    resetPreviewBtn,
    saveBtn,
    ...(shareBtn ? [shareBtn] : []),
    backBtn,
  );

  // -- preview lifecycle ----------------------------------------------------------------------
  function enterPreview(): void {
    if (previewMode === "preview") {
      preview?.play();
      return;
    }
    previewMode = "preview";
    engine.setPreviewGate(true);
    preview = createPreviewController(engine.toLevel(), {
      canvas,
      inputTarget: canvas,
      settings: opts.storage.getSettings(),
    });
    preview.play();
    updateToolbarState();
    refreshPanel();
  }

  function resetPreview(): void {
    preview?.destroy();
    preview = null;
    previewMode = "edit";
    engine.setPreviewGate(false);
    updateToolbarState();
    refreshPanel();
  }

  // -- resize -----------------------------------------------------------------------------------
  function applyCanvasSize(): void {
    const rect = canvasWrap.getBoundingClientRect();
    const cssW = rect.width > 0 ? rect.width : 960;
    const cssH = rect.height > 0 ? rect.height : 600;
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    editRenderer.resize(cssW, cssH, dpr);
    engine.setViewport({ width: cssW, height: cssH });
  }
  applyCanvasSize();

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => applyCanvasSize());
    resizeObserver.observe(canvasWrap);
  }

  // -- pointer / wheel events ---------------------------------------------------------------------
  //
  // Follow-up fix (coordinator's integration-pass "bug 5" / T-08's flagged, not-theirs-to-fix
  // finding — see notes/T-11-DRAFT/log.md for the full diagnosis): `mousemove`/`mouseup` are
  // attached to `window`, not `canvas`, ON PURPOSE — a canvas-originated drag (move a body, pan,
  // resize) must keep tracking even if the cursor leaves the canvas mid-drag, and must still
  // receive its terminating mouseup wherever the button happens to come up. The bug was that the
  // window-level `mouseup` handler ran UNCONDITIONALLY for every mouseup anywhere on the page —
  // including a plain click on a `.editor-panel` button — and called `refreshPanel()`, which does
  // `root.replaceChildren()` (a full teardown/rebuild of the panel's DOM) synchronously during that
  // same mouseup's bubble phase. Per the DOM event spec, a synthesized trailing `click` only fires
  // if the mousedown/mouseup target is still attached to the document when the UA checks — rebuilding
  // the panel out from under the just-pressed button detaches it first, so `click` silently never
  // fires. Root cause confirmed directly (not guessed): instrumented mousedown/mouseup/click firing
  // order on a real panel button — mousedown and mouseup both fired, click never did; a native
  // `element.click()` and keyboard (Tab+Enter, no mouseup at all) both worked, isolating the break
  // to specifically the real-mouse mouseup->rebuild race.
  //
  // Fix: only let the window-level listeners act when the CURRENT gesture actually started on the
  // canvas (`pointerActive`, set by canvas's own scoped `mousedown`). A mouseup whose matching
  // mousedown never touched the canvas (e.g. a panel button click) now leaves the panel's DOM
  // completely untouched through the whole mouseup dispatch, so the browser's own `click` synthesis
  // proceeds normally and the button's real `click` listener (in panel.ts) fires and refreshes the
  // panel itself, at the correct time. A canvas-originated drag that ends off-canvas (over the
  // panel, or anywhere else) is unaffected — `pointerActive` stays true for its whole duration
  // regardless of where the pointer wanders, exactly matching the pre-fix drag behaviour.
  let pointerActive = false;

  function toLocal(ev: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onPointerDown(ev: MouseEvent): void {
    if (previewMode !== "edit") return;
    pointerActive = true;
    engine.pointerDown(toLocal(ev));
    refreshPanel();
  }
  function onPointerMove(ev: MouseEvent): void {
    if (previewMode !== "edit") return;
    // Idle (no gesture in progress): only update hover state while the cursor is actually over the
    // canvas — a bare `ev.target === canvas` check, since the canvas has no child elements. While a
    // canvas-originated gesture IS in progress, keep tracking regardless of target (see doc comment
    // above) so a drag that wanders off-canvas still updates.
    if (!pointerActive && ev.target !== canvas) return;
    engine.pointerMove(toLocal(ev));
  }
  function onPointerUp(ev: MouseEvent): void {
    if (previewMode !== "edit") return;
    if (!pointerActive) return; // this mouseup's mousedown never touched the canvas — not ours
    pointerActive = false;
    engine.pointerUp(toLocal(ev));
    refreshPanel();
  }
  function onWheel(ev: WheelEvent): void {
    if (previewMode !== "edit") return;
    if (ev.target instanceof Node && panel.el.contains(ev.target)) return; // suppress over panel
    ev.preventDefault();
    const steps = ev.deltaY < 0 ? 1 : -1;
    engine.zoomAt(steps, toLocal(ev));
  }
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") engine.cancelPlace();
  }

  canvas.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeydown);

  // -- render loop --------------------------------------------------------------------------------
  let rafHandle: number | null = null;
  let lastTimestamp: number | null = null;

  function drawEditMode(): void {
    const bodies = engine.getBodies();
    const frame: RenderFrame = {
      world: {
        bodies: bodies as Body[],
        playerIndex: bodies.findIndex((b) => b.type === "player"),
        goalIndex: engine.getGoalIndex(),
        goalRange: engine.getGoalRange(),
      },
      camera: engine.getCamera(),
      trail: [],
      prediction: null,
      forceVector: null,
      boundsWarning: 0,
      flash: 0,
      showTrail: false,
      editorOverlay: engine.getOverlay(),
    };
    editRenderer.draw(frame);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      paintEditorOverlay(
        ctx,
        engine.getOverlay(),
        engine.getBodies(),
        engine.getCamera(),
        editRenderer,
      );
    }
  }

  function tick(timestamp: number): void {
    const dt = lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    if (previewMode === "preview" && preview) {
      preview.frame(Math.min(dt, 0.25));
      if (preview.isDirty() !== engine.requiresReset()) {
        // Sync the engine's own gate to the preview's real drift signal (see log decision #4/#5
        // reconciliation) — the engine already refused mutation for the whole preview duration via
        // setPreviewGate(true) at enterPreview(); this keeps requiresReset()'s value (used for the
        // "reset stage to edit" hint text) accurate to the literal drift condition too.
        refreshPanel();
      }
    } else {
      drawEditMode();
    }
    if (rafHandle !== null) rafHandle = requestAnimationFrame(tick);
  }

  if (typeof requestAnimationFrame === "function") {
    rafHandle = requestAnimationFrame(tick);
  } else {
    drawEditMode();
  }

  return {
    el: root,
    destroy(): void {
      if (rafHandle !== null && typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(rafHandle);
      rafHandle = null;
      resizeObserver?.disconnect();
      preview?.destroy();
      canvas.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeydown);
    },
  };
}
