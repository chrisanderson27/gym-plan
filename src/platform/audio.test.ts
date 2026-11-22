import { afterEach, describe, expect, it, vi } from 'vitest';
import { beep, setCuesEnabled, unlockAudio } from './audio';

afterEach(() => {
  setCuesEnabled(true);
  vi.unstubAllGlobals();
});

it('opens an audio context only when cues are enabled for the gesture', async () => {
  vi.resetModules();
  const { setCuesEnabled, unlockAudio } = await import('./audio');
  const AudioContext = vi.fn(class {
    resume() { return Promise.resolve(); }
  });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('window', { AudioContext });

  setCuesEnabled(false);
  unlockAudio();

  expect(AudioContext).not.toHaveBeenCalled();
  unlockAudio(true);
  expect(AudioContext).toHaveBeenCalledOnce();
});

describe('beep', () => {
  it('does not start an oscillator when cues are off, even after unlock', () => {
    const start = vi.fn();
    class FakeContext {
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() {
        return { frequency: { value: 0 }, connect: () => this.createGain(), start, stop() {} };
      }
      createGain() {
        const node = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => this.destination };
        return node;
      }
    }
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { AudioContext: FakeContext });
    unlockAudio();
    setCuesEnabled(false);
    beep('tick');
    expect(start).not.toHaveBeenCalled();
    setCuesEnabled(true);
    beep('go');
    expect(start).toHaveBeenCalledOnce();
  });
});
