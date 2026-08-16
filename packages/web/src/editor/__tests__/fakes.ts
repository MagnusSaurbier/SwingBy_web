/**
 * T-11 DRAFT — hand-written test fakes (canvas/2D-context/DOM-target/audio), owned entirely inside
 * `editor/**`. Not a coupling to any other task's test infra — same "duplicate a small stub rather
 * than couple" precedent T-05's and T-09's own logs record for their own fixtures (there is no
 * jsdom in this project; `HTMLCanvasElement`/`CanvasRenderingContext2D`/`document` are all
 * `undefined` under plain-Node vitest, confirmed independently here too).
 *
 * `makeFakeCanvas()` deliberately implements the full surface `createRenderer` (T-04) actually
 * touches — confirmed by reading `render/index.ts` and its own drawing modules — so tests can
 * construct a REAL `Renderer` via the REAL `createRenderer` and get REAL `worldToScreen`/
 * `screenToWorld` for hit-testing, never a reimplementation of that transform.
 */

export class FakeGradient {
  addColorStop(): void {
    /* no-op */
  }
}

export class FakeCtx {
  fillStyle: string | FakeGradient = "#000000";
  strokeStyle: string | FakeGradient = "#000000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  font = "";
  textAlign = "";
  textBaseline = "";
  calls: string[] = [];
  private record(name: string): void {
    this.calls.push(name);
  }
  beginPath(): void {
    this.record("beginPath");
  }
  closePath(): void {}
  moveTo(): void {
    this.record("moveTo");
  }
  lineTo(): void {
    this.record("lineTo");
  }
  arc(): void {
    this.record("arc");
  }
  fill(): void {
    this.record("fill");
  }
  stroke(): void {
    this.record("stroke");
  }
  fillText(): void {
    this.record("fillText");
  }
  fillRect(): void {}
  strokeRect(): void {}
  save(): void {
    this.record("save");
  }
  restore(): void {
    this.record("restore");
  }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  setTransform(): void {
    this.record("setTransform");
  }
  drawImage(): void {}
  createRadialGradient(): FakeGradient {
    return new FakeGradient();
  }
}

export function makeFakeCanvas(
  width = 960,
  height = 600,
): { canvas: HTMLCanvasElement; ctx: FakeCtx } {
  const ctx = new FakeCtx();
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: { width: "", height: "" },
    getContext(id: string) {
      return id === "2d" ? ctx : null;
    },
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}

/** A minimal fake `HTMLElement` sufficient for `createInputSource(target)` (T-06) to construct and
 *  wire listeners against without throwing — real event dispatch is never exercised in these tests
 *  (preview tests only need `createGameLoop`/`createInputSource` to construct cleanly and not crash
 *  when `frame(dt)` polls them; no keyboard/touch simulation is part of this task's scope). */
export function makeFakeTarget(): HTMLElement {
  const listeners = new Map<string, Set<(ev: unknown) => void>>();
  const target = {
    style: {} as Record<string, string>,
    addEventListener(type: string, cb: (ev: unknown) => void): void {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
    },
    removeEventListener(type: string, cb: (ev: unknown) => void): void {
      listeners.get(type)?.delete(cb);
    },
  };
  return target as unknown as HTMLElement;
}
