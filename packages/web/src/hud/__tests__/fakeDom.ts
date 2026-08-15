/**
 * T-09 GAUGE — hand-rolled fake DOM for tests. There is no jsdom in this project (confirmed:
 * `require.resolve('jsdom')` fails, `typeof document === "undefined"` under plain-Node vitest —
 * same finding T-04 AURORA and T-05 FLYWHEEL independently record for their own fake canvas/2D
 * context stubs). Lives inside `hud/**`, which I own outright, and is imported by my
 * `packages/web/test/hud*.test.ts` files via a relative path — keeps the *.test.ts files where my
 * ownership requires them (`packages/web/test/`) without inventing an ownership-ambiguous shared
 * helper directly in that shared directory. Same "duplicate a small stub rather than couple to
 * another task's test infra" precedent as T-05's `loop.test.ts` (see notes/T-05-FLYWHEEL/log.md).
 *
 * Covers exactly the DOM surface `hud.ts`/`pause.ts`/`complete.ts`/`toast.ts` actually use:
 * createElement, classList (add/remove/toggle/contains), style (arbitrary property writes via a
 * Proxy so nothing needs to be pre-declared), textContent, setAttribute/getAttribute/dataset,
 * append/appendChild/remove, addEventListener/removeEventListener/dispatchEvent, focus().
 *
 * Also the instrument for deliverable 6 ("DOM writes per update"): every `style` property write,
 * every `textContent` write, every `classList` mutation, and every `setAttribute` call increments
 * a shared counter (`stats.writes`) — the same "call log" technique as T-04's `FakeContext.calls`,
 * generalised with a `Proxy` for `style` so it doesn't need one property listed per CSS property.
 */

export interface DomWriteStats {
  writes: number;
}

export class FakeClassList {
  private readonly set = new Set<string>();
  constructor(private readonly stats: DomWriteStats) {}
  add(...names: string[]): void {
    for (const n of names) this.set.add(n);
    this.stats.writes++;
  }
  remove(...names: string[]): void {
    for (const n of names) this.set.delete(n);
    this.stats.writes++;
  }
  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.set.has(name);
    if (next) this.set.add(name);
    else this.set.delete(name);
    this.stats.writes++;
    return next;
  }
  contains(name: string): boolean {
    return this.set.has(name);
  }
  toString(): string {
    return Array.from(this.set).join(" ");
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly classList: FakeClassList;
  readonly style: Record<string, string>;
  readonly dataset: Record<string, string> = {};
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
  private _textContent = "";
  hidden = false;
  focused = false;

  constructor(
    tagName: string,
    private readonly stats: DomWriteStats,
  ) {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList(stats);
    const statsRef = stats;
    this.style = new Proxy(
      {},
      {
        set(target: Record<string, string>, prop: string, value: string) {
          target[prop] = value;
          statsRef.writes++;
          return true;
        },
        get(target: Record<string, string>, prop: string) {
          return target[prop];
        },
      },
    );
  }

  get textContent(): string {
    return this._textContent;
  }
  set textContent(value: string) {
    this._textContent = value;
    this.stats.writes++;
    // Real textContent assignment clears children — mirror that so append-after-textContent bugs
    // would surface the same way they would in a browser.
    this.children.length = 0;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const n of nodes) {
      if (typeof n === "string") {
        const text = new FakeElement("#text", this.stats);
        text.textContent = n;
        this.appendChild(text);
      } else {
        this.appendChild(n);
      }
    }
  }

  remove(): void {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1);
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    this.stats.writes++;
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    this.stats.writes++;
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }
  removeEventListener(type: string, cb: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  dispatchEvent(ev: { type: string; [k: string]: unknown }): boolean {
    for (const cb of this.listeners.get(ev.type) ?? []) cb(ev);
    return true;
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  focus(): void {
    this.focused = true;
  }

  /** Depth-first count of this node + descendants — used to prove toast.ts never leaks nodes. */
  subtreeSize(): number {
    let n = 1;
    for (const c of this.children) n += c.subtreeSize();
    return n;
  }
}

export interface FakeDocument {
  createElement(tag: string): FakeElement;
  readonly stats: DomWriteStats;
  resetStats(): void;
}

export function createFakeDom(): FakeDocument {
  const stats: DomWriteStats = { writes: 0 };
  return {
    stats,
    createElement(tag: string): FakeElement {
      return new FakeElement(tag, stats);
    },
    resetStats(): void {
      stats.writes = 0;
    },
  };
}
