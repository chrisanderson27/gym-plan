interface AudioSessionLike {
  type: string;
}
type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let cuesEnabled = true;

/** Absent preference means on. Callers of beep do not read settings themselves. */
export function setCuesEnabled(on: boolean): void {
  cuesEnabled = on;
}

/** Call from a user tap: iOS only lets audio start inside a gesture. Never throws. */
export function unlockAudio(): void {
  try {
    const nav = navigator as unknown as { audioSession?: AudioSessionLike };
    // 'playback' lets beeps through the silent switch; set before the context exists.
    if (nav.audioSession) nav.audioSession.type = 'playback';
    if (!ctx) {
      const Ctx: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
    }
    void ctx.resume().catch(() => undefined);
  } catch {
    // Audio is a bonus: the visual cue is primary.
  }
}

export function beep(kind: 'tick' | 'go'): void {
  if (!cuesEnabled) return;
  try {
    if (!ctx) return;
    const freq = kind === 'tick' ? 880 : 1320;
    const dur = kind === 'tick' ? 0.12 : 0.3;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {
    // ignore
  }
}
