import { useEffect } from 'preact/hooks';
import { db } from './data/db';
import { useLiveQuery } from './data/live';
import { ensureDefaultSettings, getSettings } from './data/settings';
import { isCloudConfigured } from './sync/client';
import { SignInScreen } from './ui/auth/SignInScreen';
import { useAuth } from './ui/auth/useAuth';
import { BlockBuilder } from './ui/blocks/BlockBuilder';
import { BlocksScreen } from './ui/blocks/BlocksScreen';
import { CardioRoutes } from './ui/cardio/CardioRoutes';
import { HistoryDetailScreen } from './ui/history/HistoryDetailScreen';
import { HistoryScreen } from './ui/history/HistoryScreen';
import { HybridRoutes } from './ui/hybrid/HybridRoutes';
import { TemplateRunScreen } from './ui/mine/TemplateRunScreen';
import { Home } from './ui/Home';
import { LiftRoutes } from './ui/lift/LiftRoutes';
import { canonicalRoute, PROGRESS_ROUTES } from './ui/progress/routes';
import { ProgressScreen } from './ui/ProgressScreen';
import { MixedSessionScreen } from './ui/session/MixedSessionScreen';
import { MixedSummaryScreen } from './ui/session/MixedSummaryScreen';
import { showTabs, TabBar } from './ui/TabBar';
import { useRoute } from './ui/router';
import { SettingsScreen } from './ui/Settings';
import { setCuesEnabled } from './platform/audio';
import { requestPersistence } from './platform/storage';
import { applyAppearance } from './ui/theme';
import { OwnerMismatchSheet } from './ui/sync/OwnerMismatchSheet';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { WorkoutsScreen } from './ui/workouts/WorkoutsScreen';

export function App() {
  // null = loaded but no settings row yet; undefined = first tick still loading.
  const settings = useLiveQuery(async () => (await getSettings(db)) ?? null, []);
  const raw = useRoute();
  const route = canonicalRoute(raw);
  const authState = useAuth();
  const gated = !!settings && isCloudConfigured && (authState.recovery || authState.status === 'signed-out' ||
    (route === '/sign-in' && authState.status === 'guest'));
  useEffect(() => {
    if (route !== raw) location.replace('#' + route);
  }, [raw, route]);
  useEffect(() => {
    if (route === '/sign-in' && (!isCloudConfigured || authState.status === 'signed-in')) location.replace('#/');
  }, [route, authState.status]);
  // The Appearance control is gone, so the shell is always light; a stored value is kept but ignored.
  // Only apply once a row exists: applying while loading would flash the pre-painted theme back to light.
  const ready = !!settings;
  useEffect(() => {
    if (ready) applyAppearance('light');
  }, [ready]);
  useEffect(() => {
    if (settings === null) void ensureDefaultSettings(db).then(() => requestPersistence());
  }, [settings]);
  useEffect(() => {
    if (settings) setCuesEnabled(settings.soundCues !== false);
  }, [settings]);

  let body;
  if (!settings || authState.status === 'loading') {
    body = (
      <main class="screen">
        <h1>gym-plan</h1>
      </main>
    );
  } else if (gated) {
    body = <SignInScreen route={route} />;
  } else if (route === '/settings') {
    body = <SettingsScreen settings={settings} />;
  } else if (route === '/progress') {
    body = <ProgressScreen />;
  } else if (route === PROGRESS_ROUTES.history) {
    body = <HistoryScreen />;
  } else if (route.startsWith('/lift')) {
    body = <LiftRoutes route={route} settings={settings} />;
  } else if (/^\/(burn|run|swim)(\/|$)/.test(route)) {
    body = <CardioRoutes route={route} settings={settings} />;
  } else if (route.startsWith('/hybrid')) {
    body = <HybridRoutes route={route} />;
  } else if (route.startsWith('/workout/session/')) {
    body = <MixedSessionScreen key={route} id={route.split('/')[3]!} />;
  } else if (route.startsWith('/workout/summary/')) {
    body = <MixedSummaryScreen key={route} id={route.split('/')[3]!} />;
  } else if (route.startsWith('/history/')) {
    body = <HistoryDetailScreen key={route} id={route.split('/')[2]!} />;
  } else if (route.startsWith('/mine/')) {
    body = <TemplateRunScreen key={route} templateId={route.split('/')[2]!} />;
  } else if (route.startsWith('/again/')) {
    body = <TemplateRunScreen key={route} sessionId={route.split('/')[2]!} />;
  } else if (route === '/workouts') {
    body = <WorkoutsScreen settings={settings} />;
  } else if (route === '/blocks') {
    body = <BlocksScreen settings={settings} />;
  } else if (route.startsWith('/blocks/')) {
    body = <BlockBuilder key={route} route={route} settings={settings} />;
  } else {
    body = <Home settings={settings} />;
  }
  return (
    <>
      {body}
      {settings && authState.status !== 'loading' && !gated && showTabs(route) && <TabBar route={route} />}
      <UpdatePrompt />
      <OwnerMismatchSheet />
    </>
  );
}
