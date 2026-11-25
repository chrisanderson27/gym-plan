import { expect, test, type Page } from '@playwright/test';
import type { Session } from '../src/data/types';
import { openLegacyBurn } from './fixtures';
import { emojiText, localDay, onboard, pageWidth, primaryCount, seedBackup, tooSmall } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });

const seconds = (clock: string | null) => (clock ?? '0:00').split(':').reduce((total, part) => total * 60 + Number(part), 0);

const sessions = (page: Page) => page.evaluate(() => new Promise<Session[]>((resolve, reject) => {
  const open = indexedDB.open('gym-plan');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const read = db.transaction('sessions').objectStore('sessions').getAll();
    read.onsuccess = () => resolve(read.result as Session[]);
    read.onerror = () => reject(read.error);
    db.close();
  };
}));

/** Nothing starts a legacy Burn any more: seed one open row by backup and resume it from Today. */
async function startBurn(page: Page) {
  await page.clock.install();
  await onboard(page, { activities: ['burn'] });
  const now = new Date();
  await seedBackup(page, { sessions: [openLegacyBurn({ now, programStart: localDay(now) })] });
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page).toHaveURL(/#\/burn\/session\//);
  await expect(page.getByTestId('burn-warmup-remaining')).toBeVisible();
}

test('legacy Burn warm-up runs and Today resumes the saved session', async ({ page }) => {
  await startBurn(page);
  const warmup = page.getByTestId('burn-warmup-remaining');
  const before = seconds(await warmup.textContent());
  await page.clock.fastForward(10_000);
  await expect.poll(async () => seconds(await warmup.textContent())).toBeLessThanOrEqual(before - 9);

  const saved = await sessions(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ type: 'burn' });
  const runner = page.url();
  await page.goto('./#/');
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page).toHaveURL(runner);
  await expect(warmup).toBeVisible();
  expect((await sessions(page)).map((row) => row.id)).toEqual(saved.map((row) => row.id));
  expect(saved[0]?.endedAt).toBeUndefined();
  expect(saved[0]?.blocks.some((b) => b.kind === 'circuit')).toBe(true);
  expect(saved[0]?.blocks.some((b) => b.kind === 'interval')).toBe(false);
  await expect(page.locator('.primary:visible')).toHaveCount(1);
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await emojiText(page)).toEqual([]);
});

test('Burn runs through circuit, backup, reload, block save and workout finish', async ({ page }) => {
  await startBurn(page);
  const open = (await sessions(page))[0]!;
  const circuit = open.blocks.find((b) => b.kind === 'circuit')!;
  await page.getByTestId('step-next').click();
  await page.getByTestId('block-start').click();
  await page.getByTestId('round-plus').click();
  await page.getByTestId('round-plus').click();
  const taken = page.getByTestId(`taken-${circuit.stations.findIndex((s) => !!s.backup)}`);
  const remaining = page.getByTestId('block-remaining');
  const before = seconds(await remaining.textContent());
  await taken.click();
  await expect(taken).toHaveText('Use original');
  await page.clock.fastForward(6_000);
  await expect.poll(async () => seconds(await remaining.textContent())).toBeLessThan(before);
  await page.reload();
  await expect(page.getByTestId('block-round')).toContainText('Round 3');
  await expect(taken).toHaveText('Use original');

  await page.clock.fastForward(circuit.durationSec * 1000);
  await expect(page.getByTestId('block-save')).toBeVisible();
  await page.getByTestId('block-save').click();
  await expect.poll(async () => (await sessions(page))[0]?.blocks.find((b) => b.kind === 'circuit')?.log?.completedRounds).toBe(2);
  await page.getByTestId('more').click();
  await page.getByTestId('more-finish-now').click();
  await page.getByTestId('finish-right').click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  expect((await sessions(page))[0]).toMatchObject({ rpe: 7, hard: true, hardCardio: true, endedAt: expect.any(String) });
});

test('old interval Burn renders in history and still runs on the timer', async ({ page }) => {
  await onboard(page, { activities: ['burn'] });
  const date = new Date(Date.now() - 3_600_000).toISOString();
  const old: Session = {
    id: 'old-burn', date, endedAt: new Date().toISOString(), type: 'burn', templateId: 'burn-tread-floor',
    blocks: [{ id: 'interval', kind: 'interval', label: 'Legacy row', rounds: 1, phases: [{ role: 'work', sec: 30, label: 'Row', exerciseId: 'rower' }] }],
    rpe: 7, hard: true, hardCardio: true, durationMin: 45, notes: '',
  };
  await seedBackup(page, {
    sessions: [old],
    templates: [{
      id: 'legacy-burn', type: 'burn', name: 'Legacy row', source: 'saved',
      createdAt: date, blocks: old.blocks,
    }],
  });
  await page.goto(`./#/history/${old.id}`);
  await expect(page.locator('main h1')).toContainText(/burn/i);
  await page.goto('./#/mine/legacy-burn');
  // Fresh Repeat of a legacy row now converts to a 45-minute standard workout.
  await expect(page.getByTestId('legacy-again')).toBeVisible();
  await expect(page.getByTestId('legacy-build')).toBeVisible();
  await page.goto('./#/burn');
  await expect(page).toHaveURL(/#\/workouts$/);
});

test('Swim uses plain-language notation and saves elapsed minutes from Start', async ({ page }) => {
  await page.clock.install();
  await onboard(page, { activities: ['swim'] });
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('pref-swim-open').click();
  await page.getByRole('button', { name: 'Save pool' }).click();
  await expect(page.getByTestId('swim-card')).toContainText(/\d+ × \d+ yd freestyle · (easy|steady)/);
  expect(await primaryCount(page)).toBe(1);
  await page.getByTestId('swim-start').click();
  await expect(page.getByTestId('swim-elapsed')).toBeVisible();
  await page.clock.fastForward(120_000);
  await page.getByTestId('swim-finish').click();
  await expect(page.getByLabel('Duration (min)')).toHaveValue('2');
  await page.getByTestId('rpe-6').click();
  await page.getByTestId('swim-save').click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  expect((await sessions(page)).find((s) => s.type === 'swim')?.durationMin).toBeGreaterThanOrEqual(1);
});
