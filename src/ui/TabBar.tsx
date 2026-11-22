import { BlocksIcon, ProgressIcon, SettingsIcon, TodayIcon, WorkoutsIcon } from './icons';

type Icon = typeof TodayIcon;
type Tab =
  | { kind: 'link'; route: string; label: string; Icon: Icon }
  | { kind: 'soon'; label: string; Icon: Icon };

const tabs: readonly Tab[] = [
  { kind: 'link', route: '/', label: 'Today', Icon: TodayIcon },
  { kind: 'soon', label: 'Workouts', Icon: WorkoutsIcon },
  { kind: 'link', route: '/blocks', label: 'Blocks', Icon: BlocksIcon },
  { kind: 'link', route: '/progress', label: 'Progress', Icon: ProgressIcon },
  { kind: 'link', route: '/settings', label: 'Settings', Icon: SettingsIcon },
];

const blocksRoute = (route: string) => route === '/blocks' || route.startsWith('/blocks/');

export const showTabs = (route: string) =>
  route === '/' || route === '/settings' || blocksRoute(route) || /^\/(progress|history|builder)(\/|$)/.test(route);

export function TabBar({ route }: { route: string }) {
  const current = route === '/' || route === '/settings' ? route : blocksRoute(route) ? '/blocks' : '/progress';
  return (
    <nav class="tab-bar" aria-label="Main">
      <div>
        {tabs.map((tab) => {
          const Icon = tab.Icon;
          return tab.kind === 'link' ? (
            <a key={tab.label} href={`#${tab.route}`} aria-current={current === tab.route ? 'page' : undefined}><span class="tab-glyph"><Icon /></span>{tab.label}</a>
          ) : (
            <button key={tab.label} type="button" disabled><span class="tab-glyph"><Icon /></span>{tab.label}</button>
          );
        })}
      </div>
    </nav>
  );
}
