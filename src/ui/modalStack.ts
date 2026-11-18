/**
 * Stack of open modals. Only the top entry handles keys, and the page behind is made inert by the stack as a whole:
 * it is re-applied for the new top whenever an entry is pushed or removed (in any order) and cleared only when the last one goes.
 * `mark(top)` must make everything outside `top` inert; `clear()` must undo every mark it made.
 */
export interface ModalStack<T> {
  push(entry: T): void;
  remove(entry: T): void;
  isTop(entry: T): boolean;
  readonly size: number;
}

export function createModalStack<T>(hooks: { mark(top: T): void; clear(): void }): ModalStack<T> {
  const entries: T[] = [];
  const refresh = () => {
    hooks.clear();
    const top = entries[entries.length - 1];
    if (top !== undefined) hooks.mark(top);
  };
  return {
    push(entry) {
      entries.push(entry);
      refresh();
    },
    remove(entry) {
      const i = entries.indexOf(entry);
      if (i === -1) return;
      entries.splice(i, 1);
      refresh();
    },
    isTop: (entry) => entries[entries.length - 1] === entry,
    get size() {
      return entries.length;
    },
  };
}
