// T-08 BRIDGE — hand-rolled router. Real URLs via the History API, no hash routing, no base path
// (see notes/T-08-BRIDGE/log.md "Framework decision" and "Routing table" for the full reasoning).
//
// Split deliberately into pure functions (matchRoute/buildPath — no DOM, fully unit-testable) and
// a thin imperative `createRouter` wrapper (owns `window.history`/`popstate`/click interception —
// verified by driving a real browser, not a DOM double; see the log for why).

export interface RouteDef {
  /** Stable identifier, independent of the path string. */
  name: string;
  /** e.g. "/play/:levelId". Exactly one segment per `:param`; no wildcards, no optional segments. */
  pattern: string;
}

export interface RouteMatch {
  name: string;
  params: Record<string, string>;
}

/** Strips a trailing slash (except for the bare root) and collapses an empty path to "/". */
export function normalizePath(path: string): string {
  const withoutQuery = path.split("?")[0]?.split("#")[0] ?? "/";
  if (withoutQuery === "") return "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

function segments(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .filter((s) => s.length > 0);
}

/**
 * Matches `path` against `routes` in order, first match wins. Segment count must match exactly
 * (no partial/prefix matches) and every literal segment must match exactly; `:name` segments bind
 * to `params[name]` after `decodeURIComponent`. Returns `null` if nothing matches.
 */
export function matchRoute(path: string, routes: readonly RouteDef[]): RouteMatch | null {
  const pathSegs = segments(path);
  for (const route of routes) {
    const patternSegs = segments(route.pattern);
    if (patternSegs.length !== pathSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patternSegs.length; i++) {
      const p = patternSegs[i] as string;
      const s = pathSegs[i] as string;
      if (p.startsWith(":")) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(s);
        } catch {
          decoded = s;
        }
        params[p.slice(1)] = decoded;
      } else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: route.name, params };
  }
  return null;
}

/** Inverse of matching: fills a pattern's `:param` segments from `params`. Throws if a required
 *  param is missing — a build-time-shaped bug, not a runtime user input, so failing loudly is right. */
export function buildPath(pattern: string, params: Record<string, string> = {}): string {
  const parts = segments(pattern).map((seg) => {
    if (!seg.startsWith(":")) return seg;
    const key = seg.slice(1);
    const value = params[key];
    if (value === undefined) {
      throw new Error(`buildPath: missing param "${key}" for pattern "${pattern}"`);
    }
    return encodeURIComponent(value);
  });
  return "/" + parts.join("/");
}

// ---------------------------------------------------------------------------------------------
// Imperative router — thin wrapper over the History API. Manually verified in a real browser
// (see results/T-08-BRIDGE.md); not covered by vitest since there's no DOM/window in this repo's
// test environment (no jsdom — see notes/T-08-BRIDGE/log.md).
// ---------------------------------------------------------------------------------------------

export interface NavigateOptions {
  /** Use replaceState instead of pushState (no new history entry). */
  replace?: boolean;
  /** Arbitrary navigation-internal data, e.g. "return to this path after Settings". Not part of
   *  the URL — see the log's "Settings return to caller" note for why. */
  state?: unknown;
}

export interface Router {
  /** Current normalized pathname. */
  current(): string;
  /** `history.state` for the current entry, as passed to the `navigate()` that produced it. */
  state(): unknown;
  navigate(path: string, opts?: NavigateOptions): void;
  back(): void;
  /** Fires on every route change (navigate, back/forward, or the initial mount). Returns an
   *  unsubscribe function. */
  subscribe(cb: (path: string) => void): () => void;
  /** Removes the popstate listener and click interceptor. */
  destroy(): void;
}

/** Same-origin, non-modified, non-`_blank`, non-download link clicks are intercepted and turned
 *  into `navigate()` calls instead of a full page load — this is what makes internal `<a href>`s
 *  behave like a SPA while still being real, right-clickable, "open in new tab"-able links. */
export function createRouter(win: Window = window): Router {
  const listeners = new Set<(path: string) => void>();

  function notify(): void {
    const path = normalizePath(win.location.pathname);
    for (const cb of listeners) cb(path);
  }

  function onPopState(): void {
    notify();
  }
  win.addEventListener("popstate", onPopState);

  function onClick(ev: MouseEvent): void {
    if (ev.defaultPrevented || ev.button !== 0) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const target = ev.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href") ?? "";
    if (href === "" || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) {
      // Only intercept same-origin relative/absolute-path links; let the browser handle the rest.
      if (!(anchor.origin === win.location.origin)) return;
    }
    if (href.startsWith("#")) return;
    ev.preventDefault();
    router.navigate(anchor.pathname + anchor.search);
  }
  win.document.addEventListener("click", onClick);

  const router: Router = {
    current(): string {
      return normalizePath(win.location.pathname);
    },
    state(): unknown {
      return win.history.state;
    },
    navigate(path: string, opts: NavigateOptions = {}): void {
      const normalized = normalizePath(path);
      const method = opts.replace ? "replaceState" : "pushState";
      win.history[method](opts.state ?? null, "", normalized);
      notify();
    },
    back(): void {
      win.history.back();
    },
    subscribe(cb: (path: string) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy(): void {
      win.removeEventListener("popstate", onPopState);
      win.document.removeEventListener("click", onClick);
      listeners.clear();
    },
  };

  return router;
}
