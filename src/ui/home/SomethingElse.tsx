import type { Activity } from '../../engine/plan/activities';
import { ActivityIcon } from '../icons';

export function SomethingElse({ activities, quiet }: { activities: readonly Activity[]; quiet: boolean }) {
  return (
    <div class={quiet ? 'something-else quiet' : 'something-else'}>
      <span>Something else</span>
      <div>
        {activities.map((activity) => (
          <a key={activity} class="btn activity-icon" href={`#/${activity}`} data-activity={activity}
            data-testid={`something-else-${activity}`} aria-label={`Start ${activity}`}>
            <ActivityIcon activity={activity} />
          </a>
        ))}
      </div>
    </div>
  );
}
