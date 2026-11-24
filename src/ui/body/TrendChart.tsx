import { round1, type TrendPoint } from '../../engine/body';
import { trendGeometry } from './chart';

export function TrendChart({ points, goal, compact = false }: { points: TrendPoint[]; goal?: number; compact?: boolean }) {
  const window = points.slice(compact ? -30 : -60);
  const last = window.at(-1);
  const width = compact ? 240 : 358;
  const height = compact ? 84 : 180;
  const pad = compact ? 4 : 26;
  const chart = trendGeometry(window, { width, height, pad, ...(goal === undefined ? {} : { goal }) });
  if (!last || !chart) return null;
  const { dots, trendPath, goalY, min, max } = chart;
  const { x, y } = dots[0]!;
  return (
    <svg class="trend-chart" viewBox={`0 0 ${width} ${height}`} width="100%"
      role="img" aria-label={`Bodyweight trend ${round1(last.trend)} lb`} data-testid="trend-chart">
      <g aria-hidden="true">
        {!compact && goalY !== null && (
          <>
            <line class="trend-goal" x1={pad} x2={width - pad} y1={goalY} y2={goalY} vector-effect="non-scaling-stroke" />
            <text class="num" x={width - pad} y={14} text-anchor="end">Goal {goal} lb</text>
          </>
        )}
        {!compact && dots.map(({ x, y }, i) => <circle key={window[i]!.date} class="trend-dot" cx={x} cy={y} r={2} />)}
        <path class="trend-line" d={dots.length === 1 ? `${trendPath} L ${x} ${y}` : trendPath}
          data-testid="trend-line" data-last={round1(last.trend)} vector-effect="non-scaling-stroke" />
        {!compact && (
          <>
            <text class="num" x={pad} y={14}>{round1(max)} lb</text>
            <text class="num" x={pad} y={height - 4}>{round1(min)} lb</text>
          </>
        )}
      </g>
    </svg>
  );
}
