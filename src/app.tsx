import { db } from './data/db';
import { useLiveQuery } from './data/live';
import { getSettings } from './data/settings';
import { Home } from './ui/Home';
import { Onboarding } from './ui/Onboarding';
import { useRoute } from './ui/router';
import { SettingsScreen } from './ui/Settings';
import { UpdatePrompt } from './ui/UpdatePrompt';

export function App() {
  // null = loaded but no settings row yet; undefined = first tick still loading.
  const settings = useLiveQuery(async () => (await getSettings(db)) ?? null, []);
  const route = useRoute();

  let body;
  if (settings === undefined) {
    body = (
      <main class="screen">
        <h1>gym-plan</h1>
      </main>
    );
  } else if (settings === null || !settings.onboardedAt) {
    body = <Onboarding />;
  } else if (route === '/settings') {
    body = <SettingsScreen settings={settings} />;
  } else {
    body = <Home settings={settings} />;
  }
  return (
    <>
      {body}
      <UpdatePrompt />
    </>
  );
}
