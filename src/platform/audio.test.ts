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
      state = 'running';
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

  it('drops cues while suspended or interrupted and plays fresh cues after recovery', async () => {
    vi.resetModules();
    const { beep, unlockAudio } = await import('./audio');
    let state = 'suspended';
    const start = vi.fn();
    const createOscillator = vi.fn(() => ({
      frequency: { value: 0, setValueAtTime() {} },
      connect: (gain: unknown) => gain,
      start,
      stop() {},
    }));
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { AudioContext: class {
      get state() { return state; }
      currentTime = 0;
      resume() { return Promise.resolve(); }
      createOscillator = createOscillator;
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    } });
    unlockAudio();
    beep('go');
    beep('complete');
    state = 'interrupted';
    beep('tick');
    expect(createOscillator).not.toHaveBeenCalled();

    state = 'running';
    beep('go');
    beep('complete');
    expect(start).toHaveBeenCalledTimes(2);
  });
});
