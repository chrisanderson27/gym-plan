import { describe, expect, it } from 'vitest';
import { capRunSec, longest30, paceSecPerMi, weeklySoftCapSec, type RunHistoryItem } from './guardrails';

const run = (date: string, over: Partial<RunHistoryItem> = {}): RunHistoryItem => ({
  date, kind: 'easy', modality: 'run', distanceMi: 0, durationSec: 1200, rpe: 5, painFlag: false, ...over,
});
const NOW = '2026-11-20T12:00:00.000Z';

describe('guardrails', () => {
  it('longest30 ignores old runs and non-running modalities', () => {
    const h = [run('2026-11-15T12:00:00.000Z', { durationSec: 1800, distanceMi: 2 }), run('2026-09-01T12:00:00.000Z', { durationSec: 9000 }), run('2026-11-16T12:00:00.000Z', { modality: 'bike', durationSec: 5000 })];
    expect(longest30(h, NOW)).toEqual({ durationSec: 1800, distanceMi: 2 });
  });

  it('pace skips runs without a distance', () => {
    expect(paceSecPerMi([run(NOW, { distanceMi: 0 })])).toBeNull();
    expect(paceSecPerMi([run(NOW, { distanceMi: 2, durationSec: 1200 }), run(NOW, { distanceMi: 0 })])).toBe(600);
  });

  it('capRunSec applies 1.10×, the distance cap, the cold start and the floor', () => {
    expect(capRunSec(5000, { durationSec: 1800, distanceMi: 0 }, null)).toBe(1980);
    expect(capRunSec(5000, { durationSec: 1800, distanceMi: 2 }, 600)).toBe(1320); // 1.1 × 2 mi × 600
    expect(capRunSec(5000, { durationSec: 0, distanceMi: 0 }, null)).toBe(1500);
    expect(capRunSec(600, { durationSec: 3000, distanceMi: 0 }, null)).toBe(900); // floor
    expect(capRunSec(300, { durationSec: 600, distanceMi: 0 }, null)).toBe(660); // floor is min(15 min, cap): never above the cap
  });

  it('weeklySoftCapSec: +15 %, ×0.75 on cutback weeks, null with no prior week', () => {
    const START = '2026-11-01';
    const lastWeek = [run('2026-11-10T12:00:00.000Z', { durationSec: 6000 })]; // week 2
    expect(weeklySoftCapSec(lastWeek, 3, START)).toBe(6900);
    expect(weeklySoftCapSec([run('2026-11-17T12:00:00.000Z', { durationSec: 6000 })], 4, START)).toBe(4500); // week 3 → cutback week 4
    expect(weeklySoftCapSec([...lastWeek, run('2026-11-17T12:00:00.000Z', { durationSec: 1000 })], 3, START)).toBe(5900);
    expect(weeklySoftCapSec([], 4, START)).toBeNull();
  });
});
