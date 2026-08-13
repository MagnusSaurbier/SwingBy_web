// A tiny in-memory `localStorage`-shaped test double. Node has no `localStorage` global (per the
// task brief: "Write your own tiny in-memory Storage-shaped test double rather than adding a
// dependency like jsdom"), and beyond just standing in for the missing global, this one can also
// SIMULATE the two failure modes the task requires exercising:
//
//   - `throwOnWrite: true`      — every `setItem` throws, from the very first call. Models
//                                 Safari private-mode / disabled-storage: the API exists but
//                                 nothing can ever be written.
//   - `quotaBytes: N`           — `setItem` succeeds normally until the combined size of all
//                                 stored values would exceed N bytes, then throws. Models a real,
//                                 previously-working store that has genuinely filled up.
//
// Both throw a `DOMException` named "QuotaExceededError" when available (real engines use that
// name for both cases in practice), falling back to a plain `Error` with `.name` set if
// `DOMException` isn't global in whatever runs this test.

export interface FakeLocalStorageOptions {
  throwOnWrite?: boolean;
  quotaBytes?: number;
}

function quotaExceededError(message: string): Error {
  try {
    return new DOMException(message, "QuotaExceededError");
  } catch {
    const err = new Error(message);
    err.name = "QuotaExceededError";
    return err;
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export class FakeLocalStorage {
  private readonly map = new Map<string, string>();
  private readonly opts: FakeLocalStorageOptions;

  constructor(opts: FakeLocalStorageOptions = {}) {
    this.opts = opts;
  }

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.opts.throwOnWrite) {
      throw quotaExceededError("storage disabled (simulated Safari private mode)");
    }
    if (this.opts.quotaBytes !== undefined) {
      const existing = this.map.get(key);
      const currentTotal = this.totalBytes() - (existing !== undefined ? byteLength(existing) : 0);
      if (currentTotal + byteLength(value) > this.opts.quotaBytes) {
        throw quotaExceededError("quota exceeded (simulated)");
      }
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Test-only escape hatch: write underneath the simulated quota/throw rules, for setup. */
  forceSet(key: string, value: string): void {
    this.map.set(key, value);
  }

  private totalBytes(): number {
    let total = 0;
    for (const v of this.map.values()) total += byteLength(v);
    return total;
  }
}
