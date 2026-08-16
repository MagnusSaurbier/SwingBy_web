// T-13 PODIUM — the offline queue's backing store.
//
// tasks/T-13-PODIUM.md deliverable 2: "Queue failed submissions in T-10 VAULT [and retry on next
// load]." The FROZEN `Storage` interface (INTERFACES.md#webstorageindexts--t-10-vault) only
// exposes `getSettings/setSettings/getBest/recordBest/listCustomLevels/saveCustomLevel/
// deleteCustomLevel/export/import` — there is no generic key/value slot a queue array could live
// in, and `storage/index.ts` is T-10's owned file, not mine to extend. See
// notes/T-13-PODIUM/log.md finding 3 for the full reasoning.
//
// What this module does instead: reuse the EXACT SAME backing substrate and graceful-degradation
// contract T-10 VAULT's own `storage/index.ts` uses internally (probe-writable-or-fall-back-to-an-
// in-memory-Map, never throw, same `swingby:` key namespace) — "backed by VAULT's storage" in the
// sense that survives a reload and degrades identically, even though it's a sibling
// implementation rather than a call through the `Storage` interface (which cannot support this).
// This is intentionally small (~40 lines) rather than imported, because T-10's version of this
// logic is private to `storage/index.ts` (not exported) and duplicating ~40 lines is cheaper and
// more honest than reaching into another task's unexported internals.

export interface BackingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryBackingStore implements BackingStore {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function warn(message: string, err?: unknown): void {
  try {
    // eslint-disable-next-line no-console -- this module's one sanctioned diagnostic channel
    console.warn(`[swingby/net] ${message}`, err ?? "");
  } catch {
    // Logging itself must never be the thing that throws.
  }
}

function readGlobalLocalStorage(): BackingStore | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage;
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as BackingStore).getItem === "function" &&
      typeof (candidate as BackingStore).setItem === "function" &&
      typeof (candidate as BackingStore).removeItem === "function"
    ) {
      return candidate as BackingStore;
    }
    return null;
  } catch {
    return null;
  }
}

/** No-op round-trip write, used only to detect "present but throws on every write" (Safari
 *  private mode). Same probe T-10 VAULT itself uses. */
function probeWritable(store: BackingStore): boolean {
  const probeKey = "swingby:__net_probe__";
  try {
    store.setItem(probeKey, "1");
    store.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

export function chooseBackingStore(): { store: BackingStore; degraded: boolean } {
  const candidate = readGlobalLocalStorage();
  if (candidate && probeWritable(candidate)) {
    return { store: candidate, degraded: false };
  }
  return { store: new MemoryBackingStore(), degraded: true };
}

/** Read + JSON.parse a key. Never throws — returns `undefined` for missing/unreadable/corrupt,
 *  same contract as T-10 VAULT's own `readJson` (storage/index.ts). */
export function readJson(store: BackingStore, key: string): unknown {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch (err) {
    warn(`could not read "${key}", starting fresh`, err);
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    warn(`corrupt JSON at "${key}", resetting`, err);
    return undefined;
  }
}

/** Best-effort write — swallows a quota/storage failure rather than throwing. The queue is a
 *  best-effort convenience (task doc: fire-and-forget with retry), not a data path whose failure
 *  should ever surface to the player mid-game; losing a queued write to a full quota is an
 *  acceptable degradation, a crash is not. */
export function writeJson(store: BackingStore, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (err) {
    warn(`failed to persist "${key}" (kept in memory for this session)`, err);
  }
}
