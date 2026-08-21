/**
 * Hand-rolled fake DOM for tests. There is no jsdom in this project (confirmed:
 * `require.resolve('jsdom')` fails, `typeof document === "undefined"` under plain-Node vitest —
 * same finding the render and game-loop modules independently record for their own fake
 * canvas/2D context stubs). Lives inside `hud/**` and is imported by `packages/web/test/hud*.test.ts`
 * files via a relative path — same "duplicate a small stub rather than couple to another module's
 * test infra" precedent as `loop.test.ts` (see notes/archive/T-05-FLYWHEEL/log.md).
 *
 * Covers the DOM surface `hud.ts`/`pause.ts`/`complete.ts`/`toast.ts` use directly (createElement,
 * classList, style, textContent, setAttribute/dataset, append/appendChild/remove, event listeners,
 * focus) PLUS the extra surface pulled in transitively by reusing the REAL `mountIngameMenu` from
 * `pause.ts` (coordinate rather than duplicate) — `innerHTML` (a minimal single-root-tag parse,
 * enough for `fromMarkup`'s icon-markup use case), `firstElementChild`, `querySelectorAll` (a
 * small selector subset: tag name + `[attr]`/`[attr="val"]` + `:not([...])`, exactly what
 * `ui/dom.ts`'s `trapFocus` uses), `className`, and `document.activeElement` tracking. Found by
 * running the real test against the real module and extending the fake until it stopped throwing
 * — not guessed in advance (see notes/archive/T-09-GAUGE/log.md).
 *
 * Also the instrument for "DOM writes per update": every `style` property write, every
 * `textContent` write, every `classList` mutation, and every `setAttribute` call increments a
 * shared counter (`stats.writes`) — the same "call log" technique as the render module's
 * `FakeContext.calls`, generalised with a `Proxy` for `style` so it doesn't need one property
 * listed per CSS property.
 */

export interface DomWriteStats {
  writes: number;
}

interface DocState {
  activeElement: FakeElement | null;
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
  /** Backs the `className` setter (`h()` in `ui/dom.ts` sets `el.className = "a b c"` for a
   *  `class` attribute rather than calling `classList.add`). */
  replaceAll(value: string): void {
    this.set.clear();
    for (const token of value.split(/\s+/).filter(Boolean)) this.set.add(token);
    this.stats.writes++;
  }
  toString(): string {
    return Array.from(this.set).join(" ");
  }
}

/** Tiny subset of CSS selector syntax: comma-separated alternatives, each an optional tag name
 *  followed by any number of `[attr]`, `[attr="val"]`, `:not([attr])`, `:not([attr="val"])`
 *  clauses. Exactly (and only) what `ui/dom.ts`'s `trapFocus` needs
 *  (`'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'`).
 */
function matchesSimpleSelector(el: FakeElement, selector: string): boolean {
  let rest = selector.trim();
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  const clauseRe =
    /:not\(\[([^\]=]+)(?:="([^"]*)")?\]\)|\[([^\]=]+)(?:="([^"]*)")?\]/g;
  let m: RegExpExecArray | null;
  while ((m = clauseRe.exec(rest))) {
    if (m[1] !== undefined) {
      const attr = m[1];
      const val = m[2];
      const actual = el.getAttribute(attr);
      const isNegatedMatch =
        val !== undefined ? actual === val : actual !== null;
      if (isNegatedMatch) return false;
    } else if (m[3] !== undefined) {
      const attr = m[3];
      const val = m[4];
      const actual = el.getAttribute(attr);
      if (actual === null) return false;
      if (val !== undefined && actual !== val) return false;
    }
  }
  return true;
}

function matchesSelectorList(el: FakeElement, selectorList: string): boolean {
  return selectorList
    .split(",")
    .some((part) => matchesSimpleSelector(el, part.trim()));
}

export class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly classList: FakeClassList;
  readonly style: Record<string, string> & {
    setProperty(name: string, value: string): void;
    getPropertyValue(name: string): string;
    removeProperty(name: string): string;
  };
  readonly dataset: Record<string, string> = {};
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
  private _textContent = "";
  /** Always non-null in this fake — there is no real layout, so "is it laid out" (what real
   *  `offsetParent` answers) can't be meaningfully modelled. `trapFocus`'s
   *  `offsetParent !== null` check is therefore a no-op filter here, by design, not an oversight:
   *  this fake exists to prove `pause.ts`'s SESSION-side wiring, not to validate T-08's own
   *  focus-trap implementation (that's T-08's test responsibility). */
  offsetParent: unknown = {};
  hidden = false;
  id = "";

  constructor(
    tagName: string,
    private readonly stats: DomWriteStats,
    private readonly doc: DocState,
  ) {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList(stats);
    const statsRef = stats;
    const styleTarget: Record<string, string> = {};
    // Real CSSStyleDeclaration supports both direct property assignment (`style.opacity = "1"`)
    // AND method calls (`style.setProperty("--x", "1")`, used for custom properties, which aren't
    // valid JS identifiers). The Proxy's `set` trap covers the first; `get` covers the second by
    // handing back bound methods that write into the same backing object and count the same way.
    const methods = {
      setProperty: (name: string, value: string): void => {
        styleTarget[name] = value;
        statsRef.writes++;
      },
      getPropertyValue: (name: string): string => styleTarget[name] ?? "",
      removeProperty: (name: string): string => {
        const prev = styleTarget[name] ?? "";
        delete styleTarget[name];
        statsRef.writes++;
        return prev;
      },
    };
    this.style = new Proxy(styleTarget, {
      set(target: Record<string, string>, prop: string, value: string) {
        target[prop] = value;
        statsRef.writes++;
        return true;
      },
      get(target: Record<string, string>, prop: string) {
        if (
          prop === "setProperty" ||
          prop === "getPropertyValue" ||
          prop === "removeProperty"
        ) {
          return methods[prop as keyof typeof methods];
        }
        return target[prop];
      },
    }) as unknown as FakeElement["style"];
  }

  /** Real `textContent` is a computed getter — the concatenation of every descendant text node,
   *  regardless of how they got there (direct assignment, `.append(string)`, or a child element
   *  that itself has text). Computing it that way (rather than tracking one private field) is what
   *  makes `h()`-built elements with `[icon, " Resume"]`-style mixed children readable by a plain
   *  `el.textContent.includes(...)` check in a test, same as in a real browser. */
  get textContent(): string {
    if (this.tagName === "#TEXT") return this._textContent;
    let out = "";
    for (const c of this.children) out += c.textContent;
    return out;
  }
  set textContent(value: string) {
    // Real textContent assignment clears children — mirror that so append-after-textContent bugs
    // would surface the same way they would in a browser.
    this.children.length = 0;
    if (this.tagName === "#TEXT") {
      this._textContent = value;
    } else if (value) {
      const textNode = new FakeElement("#text", this.stats, this.doc);
      textNode._textContent = value; // same-class private access — not the counted public setter
      textNode.parentNode = this;
      this.children.push(textNode);
    }
    this.stats.writes++;
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(value: string) {
    this.classList.replaceAll(value);
  }

  /** Minimal parse: enough to make `ui/dom.ts`'s `fromMarkup` (`wrap.innerHTML = markup; return
   *  wrap.firstElementChild`) work for its one real use case — inlining a single-root SVG icon
   *  string. Does not parse nested markup structure; only the outermost tag name matters for
   *  anything this fake is asked to verify (icon internals are never inspected by my tests). */
  set innerHTML(markup: string) {
    this.children.length = 0;
    const match = /^\s*<([a-zA-Z][a-zA-Z0-9-]*)/.exec(markup);
    if (match) {
      const child = new FakeElement(match[1]!, this.stats, this.doc);
      child.parentNode = this;
      this.children.push(child);
    }
    this.stats.writes++;
  }
  get innerHTML(): string {
    return "";
  }

  get firstElementChild(): FakeElement | null {
    return this.children.find((c) => c.tagName !== "#TEXT") ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const n of nodes) {
      if (typeof n === "string") {
        const text = new FakeElement("#text", this.stats, this.doc);
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

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const c of node.children) {
        if (matchesSelectorList(c, selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
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
    this.doc.activeElement = this;
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
  readonly activeElement: FakeElement | null;
  readonly stats: DomWriteStats;
  resetStats(): void;
}

export function createFakeDom(): FakeDocument {
  const stats: DomWriteStats = { writes: 0 };
  const docState: DocState = { activeElement: null };
  return {
    stats,
    createElement(tag: string): FakeElement {
      return new FakeElement(tag, stats, docState);
    },
    get activeElement(): FakeElement | null {
      return docState.activeElement;
    },
    resetStats(): void {
      stats.writes = 0;
    },
  };
}
