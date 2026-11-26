export const GUEST_KEY = 'gym-plan:guest';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readGuest(storage: Store | undefined) {
  try {
    return storage?.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeGuest(storage: Store | undefined, on: boolean) {
  try {
    if (on) storage?.setItem(GUEST_KEY, '1');
    else storage?.removeItem(GUEST_KEY);
  } catch {
    // The guest choice still works for this launch when storage is blocked.
  }
}
