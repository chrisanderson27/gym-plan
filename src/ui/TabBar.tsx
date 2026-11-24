import { CalendarIcon, LayersIcon, ProgressIcon, SettingsIcon, WorkoutsIcon } from './icons';

const tabs = [
  { route: '/', label: 'Today', Icon: CalendarIcon },
  { route: '/workouts', label: 'Workouts', Icon: WorkoutsIcon },
  { route: '/blocks', label: 'Blocks', Icon: LayersIcon },
  { route: '/progress', label: 'Progress', Icon: ProgressIcon },
  { route: '/settings', label: 'Settings', Icon: SettingsIcon },
];

function activeTab(route: string) {
  if (route === '/' || route.startsWith('/workout/summary/')) return '/';
  if (route === '/workouts' || route === '/settings') return route;
  if (/^\/blocks(\/|$)/.test(route)) return '/blocks';
  if (/^\/(progress|history|builder)(\/|$)/.test(route)) return '/progress';
}

export const showTabs = (route: string) => !!activeTab(route);

export function TabBar({ route }: { route: string }) {
  const current = activeTab(route);
  return (
    <nav class="tab-bar" aria-label="Main">
      <div>
        {tabs.map(({ route, label, Icon }) => (
          <a key={route} href={`#${route}`} aria-current={current === route ? 'page' : undefined}><span class="tab-glyph"><Icon /></span>{label}</a>
        ))}
      </div>
    </nav>
  );
}
