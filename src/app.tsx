import { useEffect } from 'preact/hooks';
import { db } from './data/db';
import { useLiveQuery } from './data/live';
import { getSettings } from './data/settings';
import { BodyScreen } from './ui/body/BodyScreen';
import { BuilderScreen } from './ui/builder/BuilderScreen';
import { CardioRoutes } from './ui/cardio/CardioRoutes';
import { HistoryDetailScreen } from './ui/history/HistoryDetailScreen';
import { HistoryScreen } from './ui/history/HistoryScreen';
import { HybridRoutes } from './ui/hybrid/HybridRoutes';
import { TemplateRunScreen } from './ui/mine/TemplateRunScreen';
import { Home } from './ui/Home';
import { LiftRoutes } from './ui/lift/LiftRoutes';
import { VolumeScreen } from './ui/lift/VolumeScreen';
import { Onboarding } from './ui/Onboarding';
import { canonicalRoute, PROGRESS_ROUTES } from './ui/progress/routes';
import { ProgressScreen } from './ui/ProgressScreen';
import { showTabs, TabBar } from './ui/TabBar';
import { useRoute } from './ui/router';
import { SettingsScreen } from './ui/Settings';
import { applyAppearance } from './ui/theme';
import { UpdatePrompt } from './ui/UpdatePrompt';

export function App() {
  // null = loaded but no settings row yet; undefined = first tick still loading.
  const settings = useLiveQuery(async () => (await getSettings(db)) ?? null, []);
  const raw = useRoute();
  const route = canonicalRoute(raw);
  useEffect(() => {
    if (route !== raw) location.replace('#' + route);
  }, [raw, route]);
  // Only apply once a row exists: applying while loading would flash the pre-painted theme back to light.
  const appearance = settings ? (settings.appearance ?? 'light') : undefined;
  useEffect(() => {
    if (appearance) applyAppearance(appearance);
  }, [appearance]);

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
  } else if (route === '/progress') {
    body = <ProgressScreen />;
  } else if (route === PROGRESS_ROUTES.history) {
    body = <HistoryScreen />;
  } else if (route === PROGRESS_ROUTES.body) {
    body = <BodyScreen settings={settings} />;
  } else if (route === PROGRESS_ROUTES.volume) {
    body = <VolumeScreen />;
  } else if (route.startsWith('/lift')) {
    body = <LiftRoutes route={route} settings={settings} />;
  } else if (/^\/(burn|run|swim)(\/|$)/.test(route)) {
    body = <CardioRoutes route={route} settings={settings} />;
  } else if (route.startsWith('/hybrid')) {
    body = <HybridRoutes route={route} />;
  } else if (route.startsWith('/history/')) {
    body = <HistoryDetailScreen key={route} id={route.split('/')[2]!} />;
  } else if (route === '/builder' || route.startsWith('/builder/')) {
    body = <BuilderScreen {...(route.split('/')[2] ? { templateId: route.split('/')[2]! } : {})} />;
  } else if (route.startsWith('/mine/')) {
    body = <TemplateRunScreen templateId={route.split('/')[2]!} />;
  } else if (route.startsWith('/again/')) {
    body = <TemplateRunScreen sessionId={route.split('/')[2]!} />;
  } else {
    body = <Home settings={settings} />;
  }
  return (
    <>
      {body}
      {settings?.onboardedAt && showTabs(route) && <TabBar route={route} />}
      <UpdatePrompt />
    </>
  );
}
