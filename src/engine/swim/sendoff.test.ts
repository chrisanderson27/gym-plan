import { describe, expect, it } from 'vitest';
import { SWIM_WORKOUTS } from '../../content/swim-workouts';
import type { CssTest } from '../../data/types';
import { latestCss } from './css';
import { generateSwim, nextSwimWorkout, roundToPool } from './generator';
import { fmtClock, roundUp5, sendoffSec } from './sendoff';

let n = 0;
const makeId = () => `i${n++}`;
const css2 = { per100: 120, estimate: false };
const blocks = SWIM_WORKOUTS.find((w) => w.id === 'swim-css-intro')!.blocks;
const gen = (over: Partial<Parameters<typeof generateSwim>[0]> = {}) =>
  generateSwim({ blocks, css: css2, poolLength: 25, poolUnit: 'yd', weekIdx: 5, makeId, ...over });

describe('send-offs', () => {
  it('rounds up to :05', () => {
    expect(roundUp5(127)).toBe(130);
    expect(roundUp5(130)).toBe(130);
    expect(fmtClock(135)).toBe('2:15');
    expect(fmtClock(20)).toBe(':20');
  });

  it('CSS 2:00 → 100 CSS @ 2:15, 50 FAST @ 1:10, 100 EZ @ 2:30', () => {
    expect(sendoffSec({ swimKind: 'swim', intensity: 'CSS', distance: 100 }, 120)).toBe(135);
    expect(sendoffSec({ swimKind: 'swim', intensity: 'FAST', distance: 50 }, 120)).toBe(70);
    expect(sendoffSec({ swimKind: 'swim', intensity: 'EZ', distance: 100 }, 120)).toBe(150);
  });

  it('a 112 s CSS rounds 127 up to 130, never down', () => {
    expect(sendoffSec({ swimKind: 'swim', intensity: 'CSS', distance: 100 }, 112)).toBe(130);
  });

  it('kick and sprint are always rest-based; drills add 40 s', () => {
    expect(sendoffSec({ swimKind: 'kick', intensity: 'MOD', distance: 50 }, 120)).toBeNull();
    expect(sendoffSec({ swimKind: 'swim', intensity: 'SPRINT', distance: 25 }, 120)).toBeNull();
    expect(sendoffSec({ swimKind: 'drill', intensity: 'EZ', distance: 50 }, 120)).toBe(80);
  });

  it('send-offs derive from the latest CSS test (7:00 / 3:20 → 100 CSS @ 2:05)', () => {
    const tests: CssTest[] = [
      { id: 'old', kind: 'css', date: '2026-10-01T00:00:00.000Z', poolUnit: 'yd', t400: 480, t200: 220 },
      { id: 'new', kind: 'css', date: '2026-11-01T00:00:00.000Z', poolUnit: 'yd', t400: 420, t200: 200 },
    ];
    const css = latestCss(tests, 'yd');
    const main = gen({ css }).blocks.find((b) => b.section === 'main')!;
    expect(main.items[0]).toMatchObject({ mode: 'sendoff', seconds: 125 });
    expect(fmtClock(main.items[0]!.seconds!)).toBe('2:05');
  });
});

describe('generateSwim', () => {
  it('no CSS → every item is rest-based and the prompt shows', () => {
    const p = gen({ css: null });
    expect(p.blocks.flatMap((b) => b.items).every((i) => i.mode === 'rest' && i.seconds !== undefined)).toBe(true);
    expect(p.usesSendoffs).toBe(false);
    expect(p.prompts.join(' ')).toMatch(/CSS test/);
  });

  it('flags an estimated CSS', () => {
    expect(gen({ css: { per100: 120, estimate: true } }).prompts.join(' ')).toMatch(/estimate/);
  });

  it('flags an approximate (converted) CSS', () => {
    expect(gen({ css: { per100: 120, estimate: false, approx: true } }).prompts.join(' ')).toMatch(/approximate/);
  });

  it('rounds distances to the pool length, never to zero', () => {
    expect(roundToPool(75, 50)).toBe(100);
    expect(roundToPool(25, 50)).toBe(50);
    expect(roundToPool(10, 50)).toBe(50);
    expect(roundToPool(25, 20)).toBe(20);
    const p = gen({ poolLength: 50 });
    for (const i of p.blocks.flatMap((b) => b.items)) expect(i.distance % 50).toBe(0);
  });

  it('drops paddles before week 3', () => {
    const speed = SWIM_WORKOUTS.find((w) => w.id === 'swim-speed-pull')!.blocks;
    const has = (weekIdx: number) =>
      generateSwim({ blocks: speed, css: css2, poolLength: 25, poolUnit: 'yd', weekIdx, makeId }).blocks.some((b) => b.items.some((i) => i.equipment.includes('paddles')));
    expect(has(2)).toBe(false);
    expect(has(3)).toBe(true);
  });

  it('gives fresh ids and totals the distance', () => {
    const p = gen();
    expect(p.blocks.map((b) => b.id)).not.toEqual(blocks.map((b) => b.id));
    expect(p.totalDistance).toBe(2000);
  });

  it('nextSwimWorkout picks the least recent unlocked workout', () => {
    const defs = SWIM_WORKOUTS.map((w) => ({ id: w.id, minWeek: w.minWeek }));
    expect(nextSwimWorkout(defs, 1, {})).toBe('swim-easy-technique');
    expect(nextSwimWorkout(defs, 1, { 'swim-easy-technique': '2026-11-02', 'swim-aerobic': '2026-11-01' })).toBe('swim-css-intro');
    expect(nextSwimWorkout(defs, 8, { 'swim-easy-technique': 'z' })).toBe('swim-aerobic');
  });
});
