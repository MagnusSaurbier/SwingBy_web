/**
 * Minimal fake Canvas2D so render/**'s unit tests run under plain-Node vitest, where
 * HTMLCanvasElement/CanvasRenderingContext2D/Image/Path2D do not exist (no jsdom in this
 * project — see notes/T-04-AURORA/log.md). Every draw call is recorded as a `Call` so tests can
 * assert on the exact sequence a frame produces, which is the only way to test canvas-drawing
 * logic without a DOM (per this task's brief).
 */

export interface Call {
  method: string;
  args: unknown[];
}

class FakeGradient {
  readonly stops: { offset: number; color: string }[] = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

export class FakeContext {
  calls: Call[] = [];

  // Style state — plain settable properties, recorded on write like a real context's setters.
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  // --- path / drawing methods actually used by render/** ---
  beginPath(): void {
    this.record("beginPath");
  }
  closePath(): void {
    this.record("closePath");
  }
  moveTo(x: number, y: number): void {
    this.record("moveTo", x, y);
  }
  lineTo(x: number, y: number): void {
    this.record("lineTo", x, y);
  }
  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.record("arc", x, y, r, start, end);
  }
  fill(): void {
    this.record("fill", this.fillStyle);
  }
  stroke(): void {
    this.record("stroke", this.strokeStyle, this.lineWidth);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.record("fillRect", x, y, w, h, this.fillStyle);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.record("strokeRect", x, y, w, h, this.strokeStyle, this.lineWidth);
  }
  save(): void {
    this.record("save");
  }
  restore(): void {
    this.record("restore");
  }
  translate(x: number, y: number): void {
    this.record("translate", x, y);
  }
  rotate(angle: number): void {
    this.record("rotate", angle);
  }
  scale(x: number, y: number): void {
    this.record("scale", x, y);
  }
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.record("setTransform", a, b, c, d, e, f);
  }
  drawImage(image: unknown, dx: number, dy: number): void {
    this.record("drawImage", image, dx, dy);
  }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): FakeGradient {
    this.record("createRadialGradient", x0, y0, r0, x1, y1, r1);
    return new FakeGradient();
  }
}

export function createFakeCanvas(
  width = 800,
  height = 600,
): {
  canvas: HTMLCanvasElement;
  ctx: FakeContext;
} {
  const ctx = new FakeContext();
  const style: { width: string; height: string } = { width: "", height: "" };
  const canvas = {
    width,
    height,
    style,
    getContext(id: string) {
      return id === "2d" ? ctx : null;
    },
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
}
