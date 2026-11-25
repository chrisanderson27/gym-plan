import { expect, test, type Page } from '@playwright/test';
import type { BodyLog, LibraryBlock, Session, Settings } from '../src/data/types';
import { durationLabel } from '../src/ui/labels';
import { chooseAnother, expectTrainingInventory, localDay, onboard, pageWidth, persistedRows, seedBackup, tooSmall } from './helpers';

const now = new Date('2026-11-20T12:00:00-05:00');
test.use({ timezoneId: 'America/New_York', viewport: { width: 402, height: 874 } });

const lineup = (page: Page) => page.getByRole('region', { name: 'Workout lineup' });
const start = (page: Page) => page.getByRole('button', { name: 'Start workout' });
const sessions = (page: Page) => persistedRows<Session>(page, 'sessions');

async function seedDefaultSettings(page: Page, activities?: Settings['activities']) {
  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  // Overwrite the seeded default row; no weigh-in or weight goal is created.
  const settings: Omit<Settings, 'goalWeightLb'> = {
    id: 'settings', daysPerWeek: 5, weightUnit: 'lb', distanceUnit: 'mi',
    programStart: localDay(now), onboardedAt: now.toISOString(), backupAt: null, updatedAt: now.toISOString(),
    ...(activities && { activities }),
  };
  await page.evaluate((row) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('gym-plan');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('settings', 'readwrite');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      transaction.objectStore('settings').put(row);
    };
  }), settings);
  await page.reload();
  // Let the boot redirect settle so later hash navigation is not overridden.
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

async function warmOffline(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(async () => {
    try {
      await fetch(`./network-probe-${crypto.randomUUID()}`, { cache: 'no-store' });
      return 'online';
    } catch {
      return 'offline';
    }
  })).toBe('offline');
  await page.reload();
}

const checked: LibraryBlock = {
  id: 'checked-easy', name: 'Steady core circuit', kind: 'self-paced', durationSec: 480, recommend: true,
  stations: [{ exerciseId: 'plank', target: { unit: 'sec', amount: 20 } }, { exerciseId: 'dead-bug', target: { unit: 'reps', amount: 6 } }],
  createdAt: now.toISOString(), updatedAt: now.toISOString(),
};

for (const offline of [false, true]) {
  test(`fresh direct Start preserves the reviewed lineup and resumes one saved attempt (${offline ? 'offline' : 'online'})`, async ({ page }) => {
    await page.clock.setFixedTime(now);
    await seedDefaultSettings(page);
    if (offline) await warmOffline(page);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(start(page)).toBeEnabled();
    await expect(page.getByTestId('hero')).toContainText('Build lower-body strength');
    await expectTrainingInventory(page);
    await chooseAnother(page);
    await nav.getByRole('link', { name: 'Today' }).click();
    await expect(start(page)).toBeEnabled();
    const [settings] = await persistedRows<Settings>(page, 'settings');
    expect(settings).not.toHaveProperty('goalWeightLb');
    expect(await persistedRows(page, 'bodyLogs')).toEqual([]);
    expect(await sessions(page)).toEqual([]);
    expect(await persistedRows(page, 'templates')).toEqual([]);
    expect(await persistedRows(page, 'libraryBlocks')).toEqual([]);
    await lineup(page).getByRole('button', { name: 'Expand all' }).click();
    const rows = lineup(page).locator('[data-block-id]');
    const ids = await rows.evaluateAll((blocks) => blocks.map((b) => b.getAttribute('data-block-id')));
    const moves = await rows.evaluateAll((blocks) => blocks.map((b) => Array.from(b.querySelectorAll('[data-exercise-id]'), (m) =>
      [m.getAttribute('data-exercise-id'), m.getAttribute('data-equipment-id')])));
    const preview = await rows.allTextContents();
    await expect(rows.nth(1)).toContainText('Calibration · 1 ×');
    const deadBug = rows.locator('[data-exercise-id="dead-bug"]').first();
    await expect(deadBug).toContainText('5 reps / side');
    await expect(deadBug).not.toContainText('8 per side');
    const hero = await page.getByTestId('hero').textContent();
    await start(page).click();
    await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
    const [row] = await sessions(page);
    const mixed = row!.mixed!;
    expect(mixed.prescription.blocks.map((b) => b.id)).toEqual(ids);
    expect(mixed.prescription.blocks.map((b) => b.kind === 'strength' ? [[b.exerciseId, b.equipmentId]]
      : b.kind === 'coached' || b.kind === 'self-paced' ? b.stations!.map((s) => [s.exerciseId, s.equipmentId]) : [])).toEqual(moves);
    const seconds = mixed.prescription.blocks.reduce((sum, b, index) => {
      const time = b.kind === 'strength' ? b.sets * b.repMax * 3 + (b.sets - 1) * (b.restSec ?? 90) : b.durationSec;
      expect(preview[index]).toContain(durationLabel(time));
      return sum + time;
    }, 0);
    expect(seconds).toBeGreaterThanOrEqual(2700);
    expect(hero).toContain(durationLabel(seconds));
    expect(await persistedRows(page, 'bodyLogs')).toEqual([]);
    expect(await persistedRows<Settings>(page, 'settings')).toEqual([settings]);
    expect(await persistedRows(page, 'templates')).toEqual([]);
    expect(await persistedRows(page, 'libraryBlocks')).toEqual([]);
    const runner = page.url();
    await page.goto('./#/');
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'resume');
    await expectTrainingInventory(page);
    await chooseAnother(page);
    await nav.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await expect(page).toHaveURL(runner);
    expect((await sessions(page)).map((s) => s.id)).toEqual([row!.id]);
  });
}

for (const offline of [false, true]) {
  test(`two tabs invalidate consent with zero writes and deliberate Start copies the checked prescription (${offline ? 'offline' : 'online'})`, async ({ page, context }) => {
    await page.clock.setFixedTime(now);
    await seedDefaultSettings(page);
    if (offline) await warmOffline(page);
    await expect(start(page)).toBeEnabled();
    const second = await context.newPage();
    await second.clock.setFixedTime(now);
    await seedBackup(second, { libraryBlocks: [
      { ...checked, recommend: false, id: 'unchecked', name: 'Unchecked core' },
      { ...checked, id: 'unsupported', name: 'Unsupported floor', stations: [...checked.stations, { exerciseId: 'swim', target: { unit: 'sec', amount: 30 } }] },
      checked,
    ] }, 2);
    await second.goto('./#/');
    await expect(lineup(second).getByRole('button', { name: /Steady core circuit/ })).toBeVisible();
    await expect(lineup(page).getByRole('button', { name: /Steady core circuit/ })).toHaveCount(0);
    const stores = ['sessions', 'sets', 'equipment', 'exerciseOverrides', 'templates', 'libraryBlocks', 'settings', 'runs', 'swims', 'tests', 'bodyLogs'];
    const snapshot = () => Promise.all(stores.map((name) => persistedRows(page, name)));
    const before = await snapshot();
    await start(page).click();
    const status = page.getByRole('status').filter({ hasText: 'Workout changed' });
    await expect(status).toBeFocused();
    await expect(page).toHaveURL(/#\/$/);
    expect(await snapshot()).toEqual(before);
    await expect(lineup(page).getByRole('button', { name: /Steady core circuit/ })).toBeVisible();
    await expect(lineup(page).getByText('Unchecked core')).toHaveCount(0);
    await expect(lineup(page).getByText('Unsupported floor')).toHaveCount(0);
    await start(page).click();
    await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
    const [row] = await sessions(page);
    expect(row?.mixed?.prescription.blocks).toContainEqual(expect.objectContaining({
      name: checked.name, durationSec: checked.durationSec,
      stations: checked.stations.map((s) => ({ ...s, slotId: expect.any(String), equipmentId: 'bodyweight' })),
    }));
    expect(await persistedRows(page, 'libraryBlocks')).toHaveLength(3);
    await second.close();
  });
}

test('unavailable Today offers Workouts and preferences, and Progress preserves imported weights offline', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await seedDefaultSettings(page, ['run']);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'unavailable');
  await expect(start(page)).toHaveCount(0);
  await expectTrainingInventory(page);
  await chooseAnother(page);
  await nav.getByRole('link', { name: 'Today' }).click();
  const preferences = page.getByTestId('hero').getByRole('link', { name: 'Training preferences' });
  await preferences.focus();
  await expect(preferences).toBeFocused();
  await preferences.press('Enter');
  await expect(page).toHaveURL(/#\/settings$/);
  // The activity chips left Preferences (PRD 4 P8); re-enabling Lift now arrives through a restored backup.
  await expect(page.getByRole('group', { name: 'Activities' })).toHaveCount(0);
  const [stored] = await persistedRows<Settings>(page, 'settings');
  await seedBackup(page, { settings: [{ ...stored, activities: ['run', 'lift'], updatedAt: new Date(Date.now() + 60_000).toISOString() }] });
  expect((await persistedRows<Settings>(page, 'settings'))[0]?.activities).toEqual(['run', 'lift']);
  await nav.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByTestId('hero')).toContainText('Lower A');
  await expect(start(page)).toBeEnabled();
  expect(await sessions(page)).toEqual([]);

  await page.setViewportSize({ width: 320, height: 844 });
  await start(page).focus();
  await expect(start(page)).toBeFocused();
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(320);
  await nav.getByRole('link', { name: 'Progress' }).click();
  const card = page.getByTestId('progress-body');
  await expect(page.locator('.training-header').getByTestId('more')).toHaveCount(0);
  await expect(card).toContainText('No weigh-ins yet.');
  await expect(card.locator('a, button, input, form')).toHaveCount(0);
  await expectTrainingInventory(page);
  const weights: BodyLog[] = [
    { date: '2026-11-12', weightLb: 207, protein: false },
    { date: '2026-11-16', weightLb: 206.25, protein: true },
    { date: localDay(now), weightLb: 204.5, protein: true, waistIn: 36 },
  ];
  await seedBackup(page, { bodyLogs: weights });
  await nav.getByRole('link', { name: 'Progress' }).click();
  await expect(card).toContainText('204.5 lb · latest');
  const chart = card.getByTestId('trend-line');
  await expect(chart).toBeVisible();
  const path = (await chart.getAttribute('d'))!;
  const trend = (await chart.getAttribute('data-last'))!;
  await expect(card.getByRole('img')).toHaveAccessibleName(`Bodyweight trend ${trend} lb`);
  await expectTrainingInventory(page);
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(320);
  expect(await persistedRows<BodyLog>(page, 'bodyLogs')).toEqual(weights);

  await warmOffline(page);
  await expect(card).toContainText('204.5 lb · latest');
  await expect(card.getByRole('img')).toHaveAccessibleName(`Bodyweight trend ${trend} lb`);
  await expect(chart).toHaveAttribute('d', path);
  await expectTrainingInventory(page);
  expect(await persistedRows<BodyLog>(page, 'bodyLogs')).toEqual(weights);
});

test('saved work agrees in Today, Progress and History after an offline reload and Repeat starts a new attempt', async ({ page }) => {
  await page.clock.install({ time: now });
  await onboard(page, { activities: ['lift'] });
  await start(page).click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  const [open] = await sessions(page);
  const blocks = open!.mixed!.prescription.blocks;
  const ready = page.getByRole('button', { name: 'Start block', exact: true });
  const finish = page.getByRole('button', { name: 'Finish block', exact: true });
  const proceed = page.getByRole('button', { name: 'Continue', exact: true });
  await ready.click();
  await finish.click();
  await proceed.click();
  await page.getByRole('spinbutton', { name: 'Weight (lb)' }).fill('70');
  await page.getByRole('spinbutton', { name: 'Reps' }).fill('9');
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText('1 of 1 sets logged')).toBeVisible();
  const runner = page.url();
  await page.goto(`./#/history/${open!.id}`);
  const pendingStrength = page.getByTestId(`mixed-result-${blocks[1]!.id}`);
  await expect(pendingStrength).toContainText('In progress');
  await expect(pendingStrength).toContainText('70 lb × 9');
  await page.getByRole('link', { name: 'Resume workout', exact: true }).click();
  await expect(page).toHaveURL(runner);
  await proceed.click();

  await ready.click();
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  const liveDeadBug = page.locator('.gym-card[data-exercise-id="dead-bug"]');
  await expect(liveDeadBug).toContainText('5 reps / side');
  await expect(liveDeadBug).toContainText('Low back stays flat on the floor');
  await expect(liveDeadBug).not.toContainText('8 per side');
  const rotation = blocks[2]!;
  if (rotation.kind !== 'coached') throw new Error('Expected the coached block after strength');
  await page.clock.fastForward(rotation.durationSec * 1000);
  await page.getByRole('button', { name: /Continue to/ }).click();
  await ready.click();
  await page.getByRole('button', { name: '+1 round', exact: true }).click();
  await expect.poll(async () => (await sessions(page))[0]?.mixed?.drafts[blocks[3]!.id]?.tapped).toBe(1);
  const swap = page.getByRole('button', { name: 'Swap Reverse lunge' });
  await swap.click();
  const sheet = page.getByRole('dialog', { name: 'Swap Reverse lunge' });
  await sheet.getByRole('button', { name: 'Step-up to box' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Step-up to box' })).toBeVisible();
  await page.getByRole('button', { name: 'Swap Push-up' }).click();
  await page.getByRole('dialog', { name: 'Swap Push-up' }).getByRole('button', { name: 'Skip station' }).click();
  await finish.click();
  await page.getByLabel('Completed rounds').fill('0');
  await page.getByLabel('Partial station').selectOption({ label: '1. Step-up to box' });
  await page.getByLabel('Partial work (reps)').fill('3');
  await proceed.click();

  for (const [index, name] of ['Core & posture circuit', 'Easy movement circuit', 'Recovery'].entries()) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip block', exact: true }).click();
    await (index === 2 ? page.getByRole('button', { name: 'Finish workout' }) : proceed).click();
  }
  await expect(page.getByRole('heading', { name: /Showed up/ })).toBeVisible();
  const summaryGoal = await page.getByTestId('mixed-weekly-goal').textContent();
  const effort = page.getByRole('button', { name: 'Right', exact: true });
  await effort.click();
  await expect(effort).toHaveAttribute('aria-pressed', 'true');
  const [completed] = await sessions(page);
  expect(completed?.rpe).toBe(7);
  expect(completed!.durationMin).toBeLessThan(45);
  expect(completed?.mixed?.results[blocks[3]!.id]).toMatchObject({
    rounds: 0, partial: { count: 3, unit: 'reps' }, stationChanges: [{ afterRound: 1 }],
  });
  await page.getByRole('link', { name: 'Back to Today' }).click();
  await expect(page.getByRole('heading', { name: 'You showed up.' })).toBeVisible();
  await warmOffline(page);
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('hero')).toContainText('Strength & conditioning');
  await expectTrainingInventory(page);
  await chooseAnother(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(lineup(page)).toContainText('70 lb × 9');
  await expect(lineup(page)).toContainText('Reverse lunge → Step-up to box');
  await expect(lineup(page)).toContainText('0 rounds');
  await expect(lineup(page)).toContainText('Partial · Step-up to box · 3 reps');
  const todayRange = await page.getByTestId('week-card').getAttribute('data-from');
  const weekGoal = page.getByTestId('weekly-goal');
  await expect(weekGoal).toContainText(summaryGoal!);
  await expect(weekGoal.locator('button, a, input')).toHaveCount(0);
  await page.getByRole('link', { name: 'View progress', exact: true }).click();
  await expect(page.getByTestId('week-card')).toHaveAttribute('data-from', todayRange!);
  await expect(weekGoal).toContainText(summaryGoal!);
  const detailLink = page.getByTestId(`history-${open!.id}`);
  const repeat = page.getByRole('link', { name: `Repeat ${open!.mixed!.prescription.name}` });
  await expect(repeat).toBeVisible();
  await detailLink.click();
  await expect(page.getByTestId(`mixed-result-${blocks[3]!.id}`)).toContainText('0 rounds');
  await expect(page.getByTestId(`mixed-result-${blocks[1]!.id}`)).toContainText('70 lb × 9');
  await page.getByRole('link', { name: 'Do this again' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  const rows = await sessions(page);
  expect(rows).toHaveLength(2);
  const equipmentId = open!.mixed!.strength[blocks[1]!.id]!.equipmentId;
  const original = open!.mixed!.prescription;
  expect(rows.find((row) => row.id !== open!.id)).toMatchObject({
    rpe: null, variant: 'lower-a', mixed: {
      prescription: { ...original, blocks: original.blocks.map((block) => block.kind === 'strength' ? { ...block, equipmentId } : block) },
      results: {}, strength: { [blocks[1]!.id]: { equipmentId, targetWeight: 70 } },
    },
  });
});

test('Today keeps restored circuit actuals visible when one saved pose does not match', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await seedDefaultSettings(page);
  const block = {
    id: 'core', kind: 'self-paced' as const, name: 'Restored core circuit', durationSec: 480,
    stations: [
      { slotId: 'bug', exerciseId: 'dead-bug', equipmentId: 'bodyweight', target: { unit: 'reps' as const, amount: 6 } },
      { slotId: 'plank', exerciseId: 'plank', equipmentId: 'bodyweight', target: { unit: 'sec' as const, amount: 20 } },
    ],
  };
  const stations = block.stations.map((station) => ({ ...station, poseId: 'plank' }));
  const started = now.getTime() - 60_000;
  const row: Session = {
    id: 'restored-circuit', type: 'custom', date: new Date(started).toISOString(), endedAt: now.toISOString(),
    rpe: null, hard: false, hardCardio: false, durationMin: 1, notes: '', blocks: [],
    mixed: {
      kind: 'ordered', sourceId: 'template:core', prescription: { name: block.name, blocks: [block] }, strength: {},
      cursor: { blockId: block.id, stage: 'review', setSlot: 0 },
      stations: { core: stations }, drafts: { core: { rounds: 1, tapped: 1 } },
      timers: { core: { startedAt: started, pausedAt: null, pausedMs: 0, durationMs: 480_000, frozenElapsedMs: 60_000 } },
      results: { core: { status: 'completed', rounds: 1, elapsedMs: 60_000, stations } },
    },
  };
  await seedBackup(page, { sessions: [row] }, 2);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(lineup(page)).toContainText('1 round');
  const deadBug = lineup(page).locator('.logged-movement').filter({ hasText: 'Dead bug' });
  await expect(deadBug).toContainText('6 reps / side');
  await expect(deadBug.getByTestId('logged-pose')).toHaveCount(0);
  await expect(lineup(page).getByTestId('logged-pose')).toHaveCount(1);
});

test('prior and current week use program-start dates, completed starts and Burn-only distinct days', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await onboard(page, { activities: ['burn'] });
  const [settings] = await persistedRows<Settings>(page, 'settings');
  const burn = (id: string, date: string, endedAt?: string): Session => ({
    id, date, endedAt, type: 'burn', blocks: [], hard: true, hardCardio: true, rpe: 7, durationMin: 45, notes: '',
  });
  await seedBackup(page, {
    settings: [{ ...settings!, programStart: '2026-11-11', updatedAt: new Date(now.getTime() + 60_000).toISOString() }],
    sessions: [
      burn('before-boundary', '2026-11-18T04:35:00Z', '2026-11-18T05:20:00Z'),
      burn('first-today', '2026-11-19T14:00:00Z', '2026-11-19T14:45:00Z'),
      burn('second-today', '2026-11-19T21:00:00Z', '2026-11-19T21:45:00Z'),
      burn('unfinished', '2026-11-20T11:30:00Z'),
      { ...burn('off-activity', '2026-11-18T12:00:00Z', '2026-11-18T12:45:00Z'), type: 'lift' },
    ],
  });
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Today', exact: true }).click();
  const week = page.getByTestId('week-card');
  await expect(week).toHaveAttribute('data-from', '2026-11-18');
  await expect(week).toHaveAttribute('data-to', '2026-11-24');
  await expect(week.getByTestId('week-strip').locator('[data-finished="true"]')).toHaveCount(2);
  await expect(week.getByTestId('weekly-goal')).toContainText('1 of 2 sessions');
  await nav.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(week).toHaveAttribute('data-from', '2026-11-18');
  await expect(week.getByTestId('weekly-goal')).toContainText('1 of 2 sessions');
  await page.getByRole('button', { name: 'View last week' }).click();
  await expect(week).toHaveAttribute('data-from', '2026-11-11');
  await expect(week.getByTestId('week-strip').locator('[data-finished="true"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(week).toHaveAttribute('data-from', '2026-11-18');
});
