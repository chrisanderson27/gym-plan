import { ChevronIcon } from './icons';

const links = [
  ['history', 'History', '/history'],
  ['weigh-in', 'Weigh-in', '/weigh-in'],
  ['volume', 'Volume', '/lift/volume'],
  ['builder', 'My workouts / Builder', '/builder'],
  ['hybrid', 'Hybrid', '/hybrid'],
] as const;

export function ProgressScreen() {
  return (
    <main class="screen">
      <h1>Progress</h1>
      <ul class="progress-links">
        {links.map(([id, title, route]) => (
          <li key={id}><a class="btn" href={`#${route}`} data-testid={`progress-link-${id}`}>{title}<ChevronIcon /></a></li>
        ))}
      </ul>
    </main>
  );
}
