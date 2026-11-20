import type { TrendPoint } from '../../engine/body';

interface ChartBounds { width: number; height: number; pad: number; goal?: number }

export function trendGeometry(points: TrendPoint[], { width, height, pad, goal }: ChartBounds) {
  if (points.length === 0) return null;
  const values = points.flatMap(({ weight, trend }) => [weight, trend]);
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const x = (i: number) => points.length === 1 ? width / 2 : pad + i * (width - 2 * pad) / (points.length - 1);
  const y = (value: number) => pad + (max - value) / (max - min) * (height - 2 * pad);
  const dots = points.map(({ weight }, i) => ({ x: x(i), y: y(weight) }));
  const trendPath = points.map(({ trend }, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(trend)}`).join(' ');
  return { dots, trendPath, goalY: goal !== undefined && goal >= min && goal <= max ? y(goal) : null, min, max };
}
