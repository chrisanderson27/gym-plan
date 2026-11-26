import { expect, test, type Page } from '@playwright/test';
import { SEED_EQUIPMENT } from '../src/content/equipment';
import { STORE_NAMES } from '../src/data/stores';
import { fakeSession, mockAuth, seedStoredSession } from './auth-mocks';
import { guestStorageState } from './guest';
import { persistedRows, seedBackup } from './helpers';
import { mockRest, syncServer } from './sync-mocks';

test.skip(process.env.E2E_KEYLESS === '1', 'Needs the configured sync build');
test.use({ serviceWorkers: 'block', storageState: guestStorageState('http://localhost:4173') });

const profile = fakeSession({ email: 'athlete@example.test', name: 'Gym Plan Tester' });
const card = (page: Page) => page.getByTestId('account-card');
const status = (page: Page) => card(page).getByRole('status');
const signOut = (page: Page) => card(page).getByRole('button', { name: 'Sign out', exact: true }).click();
const signOutSheet = (page: Page) => page.getByRole('dialog', { name: 'Sign out and remove unsynced changes?' });
const deleteButton = (page: Page) => card(page).getByRole('button', { name: 'Delete account', exact: true });

function workout(id: string) {
  const date = new Date().toISOString();
  return {
    id, date, type: 'lift', variant: 'lower-a', blocks: [], hard: false, hardCardio: false, rpe: null,
    durationMin: 0, notes: '', completedAt: date,
  };
}

async function signedIn(page: Page) {
  const server = syncServer();
  const authCalls = await mockAuth(page);
  await mockRest(page, server);
  await seedStoredSession(page, profile);
  await page.goto('./#/settings');
  await expect(status(page)).toHaveText(/^Synced · /);
  return { server, authCalls };
}

async function expectCleared(page: Page) {
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  for (const store of [...STORE_NAMES, 'syncOutbox', 'syncMeta']) {
    const rows = await persistedRows(page, store);
    if (store === 'equipment') expect(rows).toEqual([...SEED_EQUIPMENT].sort((a, b) => a.id < b.id ? -1 : 1));
    else if (store === 'settings') expect(rows).toEqual([expect.objectContaining({ id: 'settings', updatedAt: new Date(0).toISOString() })]);
    else expect(rows, store).toEqual([]);
  }
  expect(await page.evaluate(() => localStorage.getItem('gym-plan:guest'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('gym-plan:auth'))).toBeNull();
}

async function confirmDelete(page: Page) {
  await deleteButton(page).click();
  await page.getByRole('dialog', { name: 'Delete your account?' })
    .getByRole('button', { name: 'Delete account', exact: true }).click();
}

test('guest can visit sign-in and choose guest again with their workout intact', async ({ page }) => {
  await seedBackup(page, { sessions: [workout('guest-workout')] });
  await card(page).getByRole('link', { name: 'Sign in to back up your workouts' }).click();
  await expect(page).toHaveURL(/#\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  expect(await persistedRows(page, 'sessions')).toEqual([expect.objectContaining({ id: 'guest-workout' })]);
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByTestId('hero')).toBeVisible();
  expect(await persistedRows(page, 'sessions')).toEqual([expect.objectContaining({ id: 'guest-workout' })]);
});

test('shows the signed-in profile and retries a failed push', async ({ page }) => {
  const { server } = await signedIn(page);
  await expect(card(page)).toContainText(profile.user.user_metadata.name);
  await expect(card(page)).toContainText(profile.user.email);

  server.rejectPush = true;
  await seedBackup(page, { sessions: [workout('retry-me')] });
  await expect(status(page)).toHaveText("Couldn't sync");
  expect(server.rows('sessions').has('retry-me')).toBe(false);
  server.rejectPush = false;
  await card(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(status(page)).toHaveText(/^Synced · /);
  expect(server.rows('sessions').has('retry-me')).toBe(true);
});

test('sign-out clears all local workouts without publishing tombstones', async ({ page }) => {
  const { server } = await signedIn(page);
  await seedBackup(page, { sessions: [workout('backed-up')] });
  await expect.poll(() => server.rows('sessions').has('backed-up')).toBe(true);
  await expect(status(page)).toHaveText(/^Synced · /);
  await expect.poll(() => persistedRows(page, 'syncOutbox')).toEqual([]);

  await signOut(page);
  await expectCleared(page);
  expect(server.rows('sessions').has('backed-up')).toBe(true);
  expect(server.pushes.flatMap(({ rows }) => rows).filter((row) => row.deleted_at)).toEqual([]);
});

test('online failed flush warns, cancel resumes sync, and explicit discard clears', async ({ page }) => {
  const { server } = await signedIn(page);
  server.rejectPush = true;
  await seedBackup(page, { sessions: [workout('keep-me')] });
  await signOut(page);
  const sheet = signOutSheet(page);
  await expect(sheet.getByText(/^1 change\b/)).toBeVisible();
  expect(server.pushes.some(({ rows }) => rows.some((row) => row.id === 'keep-me'))).toBe(true);

  server.rejectPush = false;
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(status(page)).toHaveText(/^Synced · /);
  expect(await persistedRows(page, 'sessions')).toEqual([expect.objectContaining({ id: 'keep-me' })]);

  server.rejectPush = true;
  await seedBackup(page, { sessions: [workout('discard-me')] });
  await signOut(page);
  await expect(sheet.getByText(/^1 change\b/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Sign out anyway', exact: true }).click();
  await expectCleared(page);
  expect(server.rows('sessions').has('discard-me')).toBe(false);
});

test('leaving Preferences with a sign-out warning resumes sync', async ({ page }) => {
  const { server, authCalls } = await signedIn(page);
  server.rejectPush = true;
  await seedBackup(page, { sessions: [workout('keep-on-leave')] });
  await signOut(page);
  await expect(signOutSheet(page)).toBeVisible();

  server.rejectPush = false;
  await page.evaluate(() => { window.location.hash = '/'; });
  await expect(card(page)).toHaveCount(0);
  await expect.poll(() => server.rows('sessions').has('keep-on-leave')).toBe(true);
  expect(authCalls).not.toContain('logout');
});

test('offline sign-out warns about both pending workouts and signs out on confirmation', async ({ page, context }) => {
  const { server } = await signedIn(page);
  server.rejectPush = true;
  await seedBackup(page, { sessions: [workout('offline-one'), workout('offline-two')] });
  await expect(status(page)).toHaveText("Couldn't sync");
  await context.setOffline(true);
  const previousPushes = server.pushes.length;
  await signOut(page);
  const sheet = signOutSheet(page);
  await expect(sheet.getByText(/^2 changes\b/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Sign out anyway', exact: true }).click();
  await expectCleared(page);
  expect(server.pushes).toHaveLength(previousPushes);
});

test('successful account deletion clears local data and signs out', async ({ page }) => {
  const { server } = await signedIn(page);
  await seedBackup(page, { sessions: [workout('delete-me')] });
  await expect.poll(() => server.rows('sessions').has('delete-me')).toBe(true);
  await expect(status(page)).toHaveText(/^Synced · /);
  await confirmDelete(page);
  await expectCleared(page);
  expect(server.deleteCalls).toBe(1);
});

test('failed account deletion keeps the workout, auth session and sync status', async ({ page }) => {
  const { server, authCalls } = await signedIn(page);
  await seedBackup(page, { sessions: [workout('keep-after-error')] });
  await expect.poll(() => server.rows('sessions').has('keep-after-error')).toBe(true);
  await expect(status(page)).toHaveText(/^Synced · /);
  const before = await page.evaluate(() => localStorage.getItem('gym-plan:auth'));
  const workouts = await persistedRows(page, 'sessions');
  server.rejectDelete = true;

  await confirmDelete(page);
  await expect(card(page).getByRole('alert')).toHaveText("Couldn't delete your account. Nothing was changed. Try again.");
  expect(server.deleteCalls).toBe(1);
  expect(authCalls).not.toContain('logout');
  expect(await persistedRows(page, 'sessions')).toEqual(workouts);
  expect(await page.evaluate(() => localStorage.getItem('gym-plan:auth'))).toBe(before);
  await expect(status(page)).toHaveText(/^Synced · /);
});

test('offline account deletion is disabled with an accessible explanation', async ({ page, context }) => {
  const { server } = await signedIn(page);
  await context.setOffline(true);
  await expect(deleteButton(page)).toBeDisabled();
  await expect(deleteButton(page)).toHaveAccessibleDescription('Connect to the internet to delete your account.');
  expect(server.deleteCalls).toBe(0);
});
