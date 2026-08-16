/**
 * T-11 DRAFT — undo stack for the editor engine. Snapshot-based (deep-clone the whole editable
 * state before every mutating operation), not command objects — see notes/T-11-DRAFT/log.md
 * decision #10 for why: simpler, trivially correct, and "at least placement" (the task doc's
 * literal requirement) falls out for free alongside move/resize/velocity/delete/goal/clear. No
 * redo — not required by the task doc, which only asks that undo's scope be documented.
 */

const MAX_DEPTH = 50;

export class UndoStack<T> {
  private readonly stack: T[] = [];

  constructor(private readonly clone: (value: T) => T) {}

  /** Push a snapshot of `value` (BEFORE the mutation about to happen). Oldest entries are dropped
   *  once `MAX_DEPTH` is exceeded — undo is a convenience, not a durable audit log. */
  push(value: T): void {
    this.stack.push(this.clone(value));
    if (this.stack.length > MAX_DEPTH) this.stack.shift();
  }

  /** Pops and returns the most recent snapshot, or `null` if the stack is empty. */
  pop(): T | null {
    return this.stack.length > 0 ? (this.stack.pop() as T) : null;
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }

  depth(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack.length = 0;
  }
}

export const UNDO_MAX_DEPTH = MAX_DEPTH;
