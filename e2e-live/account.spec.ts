import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { persistedRows, seedBackup } from '../e2e/helpers';
import { SEED_EQUIPMENT } from '../src/content/equipment';
import { STORE_NAMES } from '../src/data/stores';
import { SYNC_TABLES } from '../src/sync/tables';
import { accessToken, localCount, password, serverRows, stack, test, user } from './helpers';

test.setTimeout(60_000);

const card = (page: Page) => page.getByTestId('account-card');
const status = (page: Page) => card(page).getByRole('status');
const signOut = (page: Page) => card(page).getByRole('button', { name: 'Sign out', exact: true }).click();
const deleteButton = (page: Page) => card(page).getByRole('button', { name: 'Delete account', exact: true });
const snapshot = (request: APIRequestContext, token: string) =>
  Promise.all(STORE_NAMES.map((store) => serverRows(request, token, SYNC_TABLES[store])));

function workout(id: string) {
  const date = new Date().toISOString();
  return {
    id, date, type: 'lift', variant: 'lower-a', blocks: [], hard: false, hardCardio: false, rpe: null,
    durationMin: 0, notes: '', completedAt: date,
  };
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

test('sign-out clears this device and leaves a second sign-in with all server rows', async ({ device, request }) => {
  const { email, token } = await user(request, 'account-sign-out');
  const { page } = await device(email);
  const timestamp = new Date().toISOString();
  await seedBackup(page, {
    sessions: [workout('server-workout')],
    libraryBlocks: [{
      id: 'server-block', name: 'Saved block', kind: 'self-paced', durationSec: 300,
      stations: [{ exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } }],
      recommend: false, createdAt: timestamp, updatedAt: timestamp,
    }],
  }, 2);
  await expect.poll(() => serverRows(request, token, 'sessions')).toEqual([{ id: 'server-workout', deleted_at: null }]);
  await expect.poll(() => serverRows(request, token, 'library_blocks')).toEqual([{ id: 'server-block', deleted_at: null }]);
  await expect(status(page)).toHaveText(/^Synced · /);
  const before = await snapshot(request, token);

  await signOut(page);
  await expectCleared(page);
  expect(await snapshot(request, token)).toEqual(before);
  const { page: other } = await device(email);
  await expect.poll(() => localCount(other, 'sessions')).toBe(1);
  await expect.poll(() => localCount(other, 'libraryBlocks')).toBe(1);
});

test('a failed live push warns and cancel permits the workout to sync before sign-out', async ({ device, request }) => {
  const { email, token } = await user(request, 'account-retry');
  const { page } = await device(email, 'block');
  await page.goto('./#/settings');
  await expect(status(page)).toHaveText(/^Synced · /);
  const pushRoute = '**/rest/v1/rpc/push_rows';
  await page.route(pushRoute, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, json: { message: 'Push unavailable' } })
    : route.fallback());
  await seedBackup(page, { sessions: [workout('retry-workout')] });
  await signOut(page);
  const sheet = page.getByRole('dialog', { name: 'Sign out and remove unsynced changes?' });
  await expect(sheet.getByText(/^1 change\b/)).toBeVisible();
  expect(await serverRows(request, token, 'sessions')).toEqual([]);

  await page.unroute(pushRoute);
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await signOut(page);
  await expectCleared(page);
  expect(await serverRows(request, token, 'sessions')).toEqual([{ id: 'retry-workout', deleted_at: null }]);
});

test('deleting one account removes its login while preserving the other account across all tables', async ({ device, request }) => {
  const a = await user(request, 'account-delete');
  const b = await user(request, 'account-keep');
  const { page: deleting } = await device(a.email);
  const { page: keeping } = await device(b.email);
  await seedBackup(deleting, { sessions: [workout('delete-workout')] });
  await seedBackup(keeping, { sessions: [workout('keep-workout')] });
  await expect.poll(() => serverRows(request, a.token, 'sessions')).toEqual([{ id: 'delete-workout', deleted_at: null }]);
  await expect.poll(() => serverRows(request, b.token, 'sessions')).toEqual([{ id: 'keep-workout', deleted_at: null }]);
  await expect(status(deleting)).toHaveText(/^Synced · /);
  await expect(status(keeping)).toHaveText(/^Synced · /);
  const before = await snapshot(request, b.token);

  await deleteButton(deleting).click();
  await deleting.getByRole('dialog', { name: 'Delete your account?' })
    .getByRole('button', { name: 'Delete account', exact: true }).click();
  await expectCleared(deleting);
  const { apiUrl, publishableKey } = stack();
  const invalid = await request.post(`${apiUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: publishableKey }, data: { email: a.email, password },
  });
  expect(invalid.status()).toBe(400);
  expect(await snapshot(request, await accessToken(request, b.email, password))).toEqual(before);
});

test('account deletion is disabled offline', async ({ device, request }) => {
  const { email } = await user(request, 'account-offline');
  const { page, context } = await device(email);
  await page.goto('./#/settings');
  await expect(status(page)).toHaveText(/^Synced · /);
  await context.setOffline(true);
  await expect(deleteButton(page)).toBeDisabled();
});
