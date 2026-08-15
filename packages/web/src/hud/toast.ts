/**
 * T-09 GAUGE — deliverable 4: toast queue. Short non-blocking messages ("Target reached", "Saved
 * custom stage"). Timing ported from Godot's own `show_toast` (`HUDController.gd:68-77`): 0.2s
 * slide-in ease-out-back, 1.3s hold, 0.4s fade-out (1.9s total per toast).
 *
 * DELIBERATE DIVERGENCE FROM GODOT, recorded so it doesn't read as a missed detail: Godot's
 * `show_toast` has exactly one `toast_label` and a NEW call just overwrites its text and restarts
 * the tween — a rapid burst INTERRUPTS the currently-showing toast with the latest one, nothing
 * queues. This module's own deliverable name ("Toast queue") and its DoD ("Toasts queue and
 * expire; a burst does not stack into a wall... queued toasts drain") explicitly ask for genuine
 * FIFO queueing instead, so that's what this implements — see notes/T-09-GAUGE/log.md.
 *
 * "Does not stack into a wall": literally true here, not just metaphorically — there is exactly
 * ONE toast DOM node, reused for every message, never more than one mounted at a time. A burst
 * queues as plain strings (cheap) and drains one at a time through that single node.
 */

export interface ToastQueueOptions {
  /** Slide-in duration, ms. Default 200 (Godot: 0.2s, `EASE_OUT`/`TRANS_BACK`). */
  enterMs?: number;
  /** Fully-visible hold duration, ms. Default 1300 (Godot: 1.3s). */
  holdMs?: number;
  /** Fade-out duration, ms. Default 400 (Godot: 0.4s, `EASE_IN`). */
  exitMs?: number;
  /** Queue depth cap — a pathological flood drops new arrivals past this rather than growing
   *  unboundedly. Default 32, comfortably above the DoD's own stress test (20 toasts/2s), so that
   *  scenario never engages this branch; documented, not silent. */
  maxQueued?: number;
}

export interface ToastQueue {
  /** Container to append into the page once, at mount time. Never rebuilt. */
  el: HTMLElement;
  /** Enqueues a message. Empty/whitespace-only messages are dropped silently (nothing to show). */
  show(message: string): void;
  /** Number of messages waiting behind the one currently showing (if any). Test/debug surface. */
  pendingCount(): number;
  /** The message currently visible, or `null` if the queue is idle. Test/debug surface. */
  currentMessage(): string | null;
  destroy(): void;
}

const DEFAULT_ENTER_MS = 200;
const DEFAULT_HOLD_MS = 1300;
const DEFAULT_EXIT_MS = 400;
const DEFAULT_MAX_QUEUED = 32;

export function createToastQueue(opts: ToastQueueOptions = {}): ToastQueue {
  const enterMs = opts.enterMs ?? DEFAULT_ENTER_MS;
  const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
  const exitMs = opts.exitMs ?? DEFAULT_EXIT_MS;
  const maxQueued = opts.maxQueued ?? DEFAULT_MAX_QUEUED;

  const el = document.createElement("div");
  el.classList.add("sb-toast-layer");
  el.setAttribute("aria-live", "polite");

  const node = document.createElement("div");
  node.classList.add("sb-toast");
  el.appendChild(node);

  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;
  let destroyed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function advance(): void {
    if (destroyed) return;
    const next = queue.shift();
    if (next === undefined) {
      node.classList.remove("sb-toast-enter", "sb-toast-visible", "sb-toast-exit");
      visible = false;
      timer = null;
      return;
    }
    node.textContent = next;
    node.classList.remove("sb-toast-exit", "sb-toast-visible");
    node.classList.add("sb-toast-enter");
    visible = true;
    timer = setTimeout(() => {
      node.classList.remove("sb-toast-enter");
      node.classList.add("sb-toast-visible");
      timer = setTimeout(() => {
        node.classList.remove("sb-toast-visible");
        node.classList.add("sb-toast-exit");
        timer = setTimeout(advance, exitMs);
      }, holdMs);
    }, enterMs);
  }

  return {
    el,
    show(message: string): void {
      if (destroyed) return;
      const text = message.trim();
      if (!text) return;
      if (queue.length >= maxQueued) return; // flood guard, see option doc comment
      queue.push(text);
      if (!visible && timer === null) advance();
    },
    pendingCount(): number {
      return queue.length;
    },
    currentMessage(): string | null {
      return visible ? node.textContent : null;
    },
    destroy(): void {
      destroyed = true;
      clearTimer();
      queue = [];
      el.remove();
    },
  };
}
