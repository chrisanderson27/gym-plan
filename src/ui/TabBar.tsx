import { ProgressIcon, SettingsIcon, TodayIcon } from './icons';

const tabs = [
  { route: '/', label: 'Today', Icon: TodayIcon },
  { route: '/progress', label: 'Progress', Icon: ProgressIcon },
  { route: '/settings', label: 'Settings', Icon: SettingsIcon },
] as const;

export const showTabs = (route: string) =>
  route === '/' || route === '/progress' || route === '/settings' || route === '/weigh-in'
  || route === '/lift/volume' || /^\/(history|builder)(\/|$)/.test(route);

export function TabBar({ route }: { route: string }) {
  const current = route === '/' || route === '/settings' ? route : '/progress';
  return (
    <nav class="tab-bar" aria-label="Main">
      <div>
        {tabs.map(({ route: path, label, Icon }) => (
          <a key={path} href={`#${path}`} aria-current={current === path ? 'page' : undefined}><Icon />{label}</a>
        ))}
      </div>
    </nav>
  );
}
