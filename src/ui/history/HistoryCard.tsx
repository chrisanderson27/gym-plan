import type { HistoryItem } from '../../data/history';
import { activityOf } from '../../engine/plan/activities';
import { dayOf } from '../cardio/format';
import { durationLabel, prLabel, sessionTypeLabel } from '../labels';

export function HistoryCard({ item, compact = false }: { item: HistoryItem; compact?: boolean }) {
  const { session, title, numbers, prs } = item;
  const records = prs.map(prLabel).join(', ');
  const day = dayOf(session.date);
  return (
    <a class="history-card" href={'#/history/' + session.id} data-testid={'history-' + session.id}
      data-activity={activityOf(session.type) ?? undefined}>
      <span class="history-card-heading">
        <strong>{title}</strong>
        {!compact && <span class="dim num">{day}</span>}
        {prs.length > 0 && <span class="badge num" data-testid="pr-badge" title={records}>
          PR{prs.length > 1 ? ` ×${prs.length}` : ''}
          <span class="visually-hidden">. {records}</span>
        </span>}
      </span>
      <span class="history-card-metrics">
        {compact ? <span><time dateTime={day}>{day}</time> · {durationLabel(item.durationSec)}</span>
          : session.type === 'lift' && session.variant && <span>{sessionTypeLabel(session.type)}</span>}
        {numbers.filter(({ label }) => !compact || label !== 'min').map(({ value, label }) => (
          <span key={label}><span class="num">{value}</span> <span>{label}</span></span>
        ))}
        {!session.endedAt && <span>in progress</span>}
      </span>
    </a>
  );
}
