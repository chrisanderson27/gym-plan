import { expect, test, type Page } from '@playwright/test';
import { authResponse, fakeSession, mockAuth, seedStoredSession } from './auth-mocks';
import { guestStorageState } from './guest';
import { persistedRows, seedBackup, tooSmall } from './helpers';
import { mockRest, syncServer } from './sync-mocks';

test.skip(process.env.E2E_KEYLESS === '1', 'Needs the configured sync build');
test.use({ serviceWorkers: 'block', storageState: guestStorageState('http://localhost:4173') });

const accountA = fakeSession({ email: 'a@example.com', name: 'Alex' });
const otherId = '00000000-0000-4000-8000-000000000002';
const accountB = {
  ...fakeSession({ email: 'b@example.com', name: 'Blake' }),
  user: { ...accountA.user, id: otherId, email: 'b@example.com', user_metadata: { name: 'Blake' } },
  access_token: accountA.access_token.replace(/(?<=\.)[^.]+(?=\.sig$)/, Buffer.from(JSON.stringify({
    sub: otherId, exp: accountA.expires_at, role: 'authenticated',
  })).toString('base64url')),
};

function workout(id: string) {
  const date = new Date().toISOString();
  return {
    id, date, type: 'lift', variant: 'lower-a', blocks: [], hard: false, hardCardio: false, rpe: null,
    durationMin: 0, notes: '', completedAt: date,
  };
}

async function logIn(page: Page, email: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

const meta = (page: Page) => persistedRows<{ id: string; ownerId?: string; lastSyncedAt?: string }>(page, 'syncMeta');

test('guest workouts and a saved block upload on sign-in', async ({ page }) => {
  const server = syncServer();
  await mockRest(page, server);
  await mockAuth(page, { password: (route) => authResponse(route, accountA) });
  const date = new Date().toISOString();
  await seedBackup(page, {
    sessions: [workout('guest-one'), workout('guest-two')],
    libraryBlocks: [{
      id: 'guest-block', name: 'Guest block', kind: 'self-paced', durationSec: 300,
      stations: [{ exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } }], recommend: false, createdAt: date, updatedAt: date,
    }],
  }, 2);
  await page.goto('./#/sign-in');
  await logIn(page, accountA.user.email);
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect.poll(() => [...server.rows('sessions').keys()].sort()).toEqual(['guest-one', 'guest-two']);
  await expect.poll(() => server.rows('library_blocks').has('guest-block')).toBe(true);
  await expect.poll(() => persistedRows(page, 'syncOutbox')).toEqual([]);
});

test('a second device workout arrives after foregrounding', async ({ page }) => {
  const server = syncServer();
  await mockRest(page, server);
  await mockAuth(page);
  await seedStoredSession(page, accountA);
  await page.goto('./');
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect.poll(async () => (await meta(page)).find((row) => row.id === 'owner')?.lastSyncedAt).toBeTruthy();
  const data = workout('other-device');
  const timestamp = new Date().toISOString();
  server.rows('sessions').set(data.id, {
    id: data.id, data, client_updated_at: timestamp, updated_at: timestamp, deleted_at: null,
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => persistedRows(page, 'sessions')).toContainEqual(expect.objectContaining({ id: data.id }));
});

test('pending changes from a different owner require a discard choice before sync', async ({ page }) => {
  const server = syncServer();
  server.rejectPush = true;
  await mockRest(page, server);
  await mockAuth(page, { password: (route) => authResponse(route,
    (route.request().postDataJSON() as { email: string }).email === accountA.user.email ? accountA : accountB) });
  await seedBackup(page, { sessions: [workout('old-owner')] });
  await page.goto('./#/sign-in');
  await logIn(page, accountA.user.email);
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect.poll(async () => (await meta(page)).find((row) => row.id === 'owner')?.ownerId).toBe(accountA.user.id);
  await expect.poll(() => server.pushes.length).toBeGreaterThan(0);
  await expect.poll(() => persistedRows(page, 'syncOutbox')).toContainEqual(
    expect.objectContaining({ store: 'sessions', key: 'old-owner' }),
  );

  await page.evaluate((key) => localStorage.removeItem(key), 'gym-plan:auth');
  await page.reload();
  server.rejectPush = false;
  const pastPushes = server.pushes.length;
  await logIn(page, accountB.user.email);
  const sheet = page.getByRole('dialog', { name: "This phone has someone else's workouts" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/^1 change from the previous account\b/)).toBeVisible();
  expect(await tooSmall(page)).toEqual([]);
  expect(server.pushes.slice(pastPushes)).toEqual([]);
  await sheet.getByRole('button', { name: 'Remove and continue' }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => persistedRows(page, 'sessions')).toEqual([]);
  await expect.poll(async () => (await meta(page)).find((row) => row.id === 'owner')?.ownerId).toBe(accountB.user.id);
  expect(server.rows('sessions').has('old-owner')).toBe(false);
  expect(server.pushes.slice(pastPushes).flatMap(({ rows }) => rows.map((row) => row.id))).not.toContain('old-owner');
});
