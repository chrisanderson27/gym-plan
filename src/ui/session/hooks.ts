import { useEffect, useRef, useState } from 'preact/hooks';
import { holdWakeLock } from '../../platform/wakelock';

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
  return now;
}

export function useWakeLock(active: boolean) {
  useEffect(() => active ? holdWakeLock() : undefined, [active]);
}

export function useStoredState<T>(key: string, restore: (saved: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return restore(saved === null ? null : JSON.parse(saved));
    } catch {
      return restore(null);
    }
  });
  const current = useRef(value);
  const update = (change: (prev: T) => T) => {
    const next = change(current.current);
    current.current = next;
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // The running block still works when browser storage is unavailable.
    }
  };
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // There may be no backing store to clear.
    }
  };
  return [value, update, clear] as const;
}
