import { expect, it } from 'vitest';
import { trendGeometry } from './chart';

const bounds = { width: 100, height: 80, pad: 10 };
const points = [
  { date: '2026-11-01', weight: 249, trend: 249 },
  { date: '2026-11-02', weight: 244, trend: 248 },
  { date: '2026-11-19', weight: 245, trend: 247 },
];

it('has no geometry without weigh-ins', () => {
  expect(trendGeometry([], bounds)).toBeNull();
});

it('centres a single weigh-in in a padded non-zero domain', () => {
  expect(trendGeometry(points.slice(0, 1), bounds)).toEqual({
    dots: [{ x: 50, y: 40 }], trendPath: 'M 50 40', goalY: null, min: 248, max: 250,
  });
});

it('spaces logged days evenly and scales weights and trends into the padded box', () => {
  const result = trendGeometry(points, bounds)!;
  expect(result.dots.map(({ x }) => x)).toEqual([10, 50, 90]);
  const coords = [...result.dots, ...result.trendPath.split(/ [ML] /).map((step) => {
    const [x, y] = step.replace(/^M /, '').split(' ').map(Number);
    return { x: x!, y: y! };
  })];
  for (const { x, y } of coords) {
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThanOrEqual(90);
    expect(y).toBeGreaterThanOrEqual(10);
    expect(y).toBeLessThanOrEqual(70);
  }
  expect([result.min, result.max]).toEqual([243, 250]);
});

it('plots only a goal inside the data domain', () => {
  const inRange = trendGeometry(points, { ...bounds, goal: 250 })!;
  expect(inRange.goalY).toBe(10);
  expect(trendGeometry(points, { ...bounds, goal: 100 })).toEqual({ ...inRange, goalY: null });
});
