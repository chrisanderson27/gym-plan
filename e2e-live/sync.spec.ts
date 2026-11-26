import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { persistedRows, seedBackup } from '../e2e/helpers';
import { STORE_NAMES } from '../src/data/stores';
import type { LibraryBlock, Session, Settings, SyncMeta } from '../src/data/types';
import { SYNC_TABLES } from '../src/sync/tables';
import {
  accessToken, confirmViaApi, fillLogIn, foreground, localCount, serverRows, signedInContext, signUpViaApi, uniqueEmail,
} from './helpers';

const password = 'test-password-123';
const test = base.extend<{ device: (email: string) => ReturnType<typeof signedInContext> }>({
  // Contexts opened by the fixture need the same cleanup as Playwright's built-in context.
  device: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async (email) => {
        const result = await signedInContext(browser, email, password);
        contexts.push(result.context);
        return result;
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

test.setTimeout(60_000);

async function user(request: APIRequestContext, tag: string) {
  const email = uniqueEmail(tag);
  const response = await signUpViaApi(request, { email, password, name: 'Gym Plan Tester' });
  expect(response.ok()).toBe(true);
  await confirmViaApi(request, email);
  return { email, token: await accessToken(request, email, password) };
}

async function logIn(page: Page, email: string) {
  await fillLogIn(page, email, password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByTestId('hero')).toBeVisible();
}

function block(id: string, name = id): LibraryBlock {
  const timestamp = new Date().toISOString();
  return {
    id, name, kind: 'self-paced', durationSec: 300,
    stations: [{ exerciseId: 'push-up', target: { unit: 'reps', amount: 8 } }],
    recommend: false, createdAt: timestamp, updatedAt: timestamp,
  };
}

function workout(id: string) {
  const date = new Date().toISOString();
  return {
    id, date, type: 'lift', variant: 'lower-a', blocks: [], hard: false, hardCardio: false, rpe: null,
    durationMin: 0, notes: '', completedAt: date,
  };
}

const blocks = (page: Page) => persistedRows<LibraryBlock>(page, 'libraryBlocks');
const sessions = (page: Page) => persistedRows<Session>(page, 'sessions');

async function waitForSync(page: Page) {
  await expect.poll(async () => (await persistedRows<SyncMeta>(page, 'syncMeta'))
    .find((row) => row.id === 'owner')?.lastSyncedAt).toBeTruthy();
  await expect.poll(() => localCount(page, 'syncOutbox')).toBe(0);
}

async function expectBlock(page: Page, data: LibraryBlock) {
  await expect.poll(() => blocks(page)).toContainEqual(expect.objectContaining({ id: data.id, name: data.name }));
}

test('each device receives the block created on the other device', async ({ device, request }) => {
  const { email, token } = await user(request, 'two-devices');
  const { page: a } = await device(email);
  const { page: b } = await device(email);
  const first = block('block-a', 'Device A block');
  const second = block('block-b', 'Device B block');

  await seedBackup(a, { libraryBlocks: [first] }, 2);
  await seedBackup(b, { libraryBlocks: [second] }, 2);
  await expect.poll(async () => (await serverRows(request, token, 'library_blocks')).map(({ id }) => id))
    .toEqual([first.id, second.id]);
  await foreground(a);
  await expectBlock(a, second);
  await foreground(b);
  await expectBlock(b, first);
});

test('both devices converge to the later edit even when the older edit syncs last', async ({ device, request }) => {
  const { email, token } = await user(request, 'later-edit');
  const a = await device(email);
  const b = await device(email);
  const original = block('shared', 'Original block');
  await seedBackup(a.page, { libraryBlocks: [original] }, 2);
  await expect.poll(() => serverRows(request, token, 'library_blocks')).toEqual([{ id: original.id, deleted_at: null }]);
  await foreground(b.page);
  await expectBlock(b.page, original);
  await waitForSync(a.page);
  await waitForSync(b.page);

  await a.page.goto('./#/');
  await b.page.goto('./#/');
  await a.context.setOffline(true);
  await b.context.setOffline(true);
  const oldEdit = { ...original, name: 'Older edit', updatedAt: new Date().toISOString() };
  await seedBackup(a.page, { libraryBlocks: [oldEdit] }, 2);
  const winner = { ...original, name: 'Later edit', updatedAt: new Date().toISOString() };
  await seedBackup(b.page, { libraryBlocks: [winner] }, 2);
  const pending = async (page: Page) => (await persistedRows<{ key: string; clientUpdatedAt: string }>(page, 'syncOutbox'))
    .find((entry) => entry.key === original.id)?.clientUpdatedAt;
  expect(Date.parse((await pending(b.page))!)).toBeGreaterThan(Date.parse((await pending(a.page))!));

  await b.context.setOffline(false);
  await foreground(b.page);
  await waitForSync(b.page);
  await a.context.setOffline(false);
  await foreground(a.page);
  await expectBlock(a.page, winner);
  await foreground(b.page);
  await expectBlock(b.page, winner);
});

test('deleting a block on A removes it from B', async ({ device, request }) => {
  const { email, token } = await user(request, 'tombstone');
  const { page: a } = await device(email);
  const { page: b } = await device(email);
  const data = block('delete-me', 'Delete this block');
  await seedBackup(a, { libraryBlocks: [data] }, 2);
  await expect.poll(() => serverRows(request, token, 'library_blocks')).toEqual([{ id: data.id, deleted_at: null }]);
  await foreground(b);
  await expectBlock(b, data);

  await a.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Blocks', exact: true }).click();
  await expect(a.getByRole('heading', { name: 'My Blocks', exact: true })).toBeVisible();
  await a.getByRole('button', { name: `Remove ${data.name}`, exact: true }).click();
  await a.getByTestId('block-remove-confirm').click();
  await expect.poll(() => blocks(a)).toEqual([]);
  await expect.poll(() => serverRows(request, token, 'library_blocks'))
    .toEqual([{ id: data.id, deleted_at: expect.any(String) }]);
  await foreground(b);
  await expect.poll(() => blocks(b)).toEqual([]);
});

test('guest data reaches the server with the same per-store counts', async ({ page, request }) => {
  const { email, token } = await user(request, 'guest-upload');
  await page.goto('./');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await seedBackup(page, {
    sessions: [workout('guest-workout')],
    libraryBlocks: [block('guest-block', 'Guest block')],
    bodyLogs: [{ date: new Date().toISOString().slice(0, 10), weightLb: 155, protein: false }],
  }, 2);
  await page.goto('./#/sign-in');
  await logIn(page, email);
  await waitForSync(page);
  for (const store of STORE_NAMES) {
    const count = await localCount(page, store);
    if (!count) continue;
    await expect.poll(async () => (await serverRows(request, token, SYNC_TABLES[store]))
      .filter((row) => row.deleted_at === null).length, { message: store }).toBe(count);
  }
});

test('an offline Swim uploads once after reconnect', async ({ device, request }) => {
  const { email, token } = await user(request, 'offline-swim');
  const { page, context } = await device(email);
  await waitForSync(page);
  const [settings] = await persistedRows<Settings>(page, 'settings');
  await seedBackup(page, { settings: [{ ...settings!, activities: ['swim'], updatedAt: new Date().toISOString() }] }, 2);
  await page.getByTestId('pref-swim-open').click();
  await page.getByRole('button', { name: 'Save pool' }).click();
  await expect(page.getByTestId('swim-card')).toBeVisible();
  await waitForSync(page);
  const before = await serverRows(request, token, 'sessions');

  await context.setOffline(true);
  await page.getByTestId('swim-start').click();
  await expect(page.getByTestId('swim-elapsed')).toBeVisible();
  await page.getByTestId('swim-finish').click();
  await page.getByLabel('Duration (min)').fill('2');
  await page.getByTestId('rpe-6').click();
  await page.getByTestId('swim-save').click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  const saved = (await sessions(page)).find((row) => row.type === 'swim');
  expect(saved).toBeDefined();

  await context.setOffline(false);
  await expect.poll(async () => (await serverRows(request, token, 'sessions')).filter((row) => row.id === saved!.id))
    .toEqual([{ id: saved!.id, deleted_at: null }]);
  await waitForSync(page);
  const first = await serverRows(request, token, 'sessions');
  expect(first).toHaveLength(before.length + 1);
  const syncedAt = async () => (await persistedRows<SyncMeta>(page, 'syncMeta')).find((row) => row.id === 'owner')?.lastSyncedAt;
  const last = await syncedAt();
  await foreground(page);
  await expect.poll(syncedAt).not.toBe(last);
  expect(await serverRows(request, token, 'sessions')).toEqual(first);
});

test('another account never sees or uploads the previous owner’s rows', async ({ device, request }) => {
  const a = await user(request, 'previous-owner');
  const b = await user(request, 'new-owner');
  const { page } = await device(a.email);
  const session = workout('owners-workout');
  const savedBlock = block('owners-block', 'Previous owner block');
  await seedBackup(page, { sessions: [session], libraryBlocks: [savedBlock] }, 2);
  await expect.poll(() => serverRows(request, a.token, 'sessions')).toEqual([{ id: session.id, deleted_at: null }]);
  await expect.poll(() => serverRows(request, a.token, 'library_blocks')).toEqual([{ id: savedBlock.id, deleted_at: null }]);
  await waitForSync(page);
  const snapshots = await Promise.all(STORE_NAMES.map((store) => serverRows(request, a.token, SYNC_TABLES[store])));

  await page.goto('./#/');
  await page.evaluate(() => localStorage.removeItem('gym-plan:auth'));
  await page.reload();
  await logIn(page, b.email);
  await expect.poll(() => sessions(page)).toEqual([]);
  await expect.poll(() => blocks(page)).toEqual([]);
  await waitForSync(page);
  await expect(page.getByRole('dialog', { name: /someone else's workouts/ })).toHaveCount(0);
  expect(await serverRows(request, b.token, 'sessions')).toEqual([]);
  expect(await serverRows(request, b.token, 'library_blocks')).toEqual([]);
  expect(await Promise.all(STORE_NAMES.map((store) => serverRows(request, a.token, SYNC_TABLES[store])))).toEqual(snapshots);
});
