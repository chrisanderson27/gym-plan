interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** Keep the screen on while a timer runs. Returns a release function; a missing API is a silent no-op. */
export function holdWakeLock(): () => void {
  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async () => {
    try {
      const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
      if (!api || released) return;
      const next = await api.request('screen');
      if (released) await next.release();
      else sentinel = next;
    } catch {
      // Denied or unsupported (WebKit < 18.4, low power mode): the timer still works.
    }
  };
  // The lock is dropped when the page hides, so take it again on return.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void acquire();
  };

  void acquire();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    try {
      void sentinel?.release().catch(() => undefined);
    } catch {
      // already released
    }
    sentinel = null;
  };
}
