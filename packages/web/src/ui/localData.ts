// T-08 BRIDGE - "delete all local data": the wipe itself, kept DOM-free so it can be unit-tested
// in node (there is no jsdom here).
//
// Why a PREFIX SWEEP rather than a hard-coded list of keys: the app's browser-side state is spread
// over more than one module - `storage/index.ts` owns `swingby:settings`, `swingby:bests`,
// `swingby:custom_levels` (T-10 VAULT) and `net/queue.ts` owns `swingby:score_queue` (T-13 PODIUM),
// with no shared registry between them. A list would have to be maintained by whoever adds the next
// key, and nothing would fail if they forgot. Sweeping the `swingby:` namespace makes "the wipe
// leaves no key behind" true by construction instead; the namespace convention is documented in
// INTERFACES.md and guarded by a test that reads those two modules' key literals.
//
// Why this module touches `localStorage` directly rather than going through T-10 VAULT: the frozen
// `Storage` interface has no `clear()` and no generic key slot, exactly the gap `net/persist.ts`
// documents at length for the submission queue. A wipe that must also cover another task's key
// cannot be expressed through that interface, and widening it would mean editing `storage/index.ts`.

/** Namespace every key the app persists must live under. See INTERFACES.md § Local data. */
export const LOCAL_DATA_KEY_PREFIX = "swingby:";

/** The slice of the DOM `Storage` API a wipe needs. Deliberately NOT `BackingStore` (the shape
 *  `storage/index.ts` and `net/persist.ts` inject): that one cannot enumerate, and enumeration is
 *  the whole point here. */
export interface EnumerableStore {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

function warn(message: string, err?: unknown): void {
  try {
    // eslint-disable-next-line no-console -- same sanctioned diagnostic channel as storage/index.ts
    console.warn(`[swingby/ui] ${message}`, err ?? "");
  } catch {
    // Logging must never be the thing that throws.
  }
}

/** `globalThis[name]` if it looks like an enumerable web Storage, else null. Never throws - merely
 *  reading `localStorage` can throw in a locked-down host (same guard as `storage/index.ts`). */
function readGlobalStore(name: string): EnumerableStore | null {
  try {
    const candidate = (globalThis as Record<string, unknown>)[name];
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as EnumerableStore).length === "number" &&
      typeof (candidate as EnumerableStore).key === "function" &&
      typeof (candidate as EnumerableStore).removeItem === "function"
    ) {
      return candidate as EnumerableStore;
    }
    return null;
  } catch {
    return null;
  }
}

/** `localStorage` and `sessionStorage`, whichever are usable. `sessionStorage` holds nothing today -
 *  it is swept anyway so a future key written there is not silently exempt. */
export function defaultStores(): EnumerableStore[] {
  const stores: EnumerableStore[] = [];
  for (const name of ["localStorage", "sessionStorage"]) {
    const store = readGlobalStore(name);
    if (store) stores.push(store);
  }
  return stores;
}

/** Every `swingby:`-prefixed key currently in `store`. Never throws - an unreadable store reports
 *  no keys rather than failing the wipe. */
export function collectLocalDataKeys(store: EnumerableStore): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null && key.startsWith(LOCAL_DATA_KEY_PREFIX)) keys.push(key);
    }
  } catch (err) {
    warn("could not enumerate a storage area, skipping it", err);
  }
  return keys;
}

/**
 * Removes every `swingby:`-prefixed key from each store and returns what it actually removed.
 * Keys outside the namespace are left untouched - on a shared origin (local dev) they are not ours.
 *
 * Never throws: a store whose `removeItem` fails (Safari private mode's shape) is reported and
 * skipped, matching the storage layer's "the game must always keep going" contract. The caller is
 * about to reload, and a wipe that threw halfway would leave the user on a dead screen with their
 * data in an unknown state.
 */
export function wipeLocalData(
  stores: readonly EnumerableStore[] = defaultStores(),
): string[] {
  const removed: string[] = [];
  for (const store of stores) {
    // Collect first, then remove: removing during enumeration reindexes a live `Storage` and skips
    // keys. Node has no localStorage to demonstrate that on, which is exactly why it is written
    // this way rather than discovered later in a browser.
    for (const key of collectLocalDataKeys(store)) {
      try {
        store.removeItem(key);
        removed.push(key);
      } catch (err) {
        warn(`could not remove "${key}"`, err);
      }
    }
  }
  return removed;
}

export interface DeleteAllLocalDataDeps {
  /** Resolves true only if the user confirmed. Nothing is read or written before it resolves. */
  confirm: () => Promise<boolean>;
  wipe?: (stores?: readonly EnumerableStore[]) => string[];
  /** Full document load. Defaults to `window.location.assign` - see `HOME_HREF` below. */
  navigate?: (href: string) => void;
}

export interface DeleteAllLocalDataResult {
  deleted: boolean;
  removedKeys: string[];
}

/** Where a wiped app lands: the main menu, by a real document load. */
export const HOME_HREF = "/";

function defaultNavigate(href: string): void {
  if (typeof window !== "undefined") window.location.assign(href);
}

/**
 * Confirm, then wipe, then reload onto the main menu.
 *
 * The reload is what makes "as if a new user opened it" true rather than merely intended: every
 * `createStorage()` instance hydrates its settings/bests/custom-level caches once at construction
 * (`storage/index.ts`), so wiping the keys under a live app would leave those caches serving data
 * that no longer exists - worse than not wiping at all. A new document rebuilds all of it from an
 * empty store, and drops the router, the live `InputSource`, the submission queue and any running
 * session with it.
 *
 * A `false` from `confirm` removes nothing and navigates nowhere: the mutation happens strictly
 * after the await, so "cancel deletes nothing" holds by construction, not by care.
 */
export async function requestDeleteAllLocalData(
  deps: DeleteAllLocalDataDeps,
): Promise<DeleteAllLocalDataResult> {
  const confirmed = await deps.confirm();
  if (!confirmed) return { deleted: false, removedKeys: [] };
  const removedKeys = (deps.wipe ?? wipeLocalData)();
  (deps.navigate ?? defaultNavigate)(HOME_HREF);
  return { deleted: true, removedKeys };
}
