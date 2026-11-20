import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SEED_EQUIPMENT } from '../src/content';
import { liftDayInputFrom } from '../src/data/liftday';
import type { CircuitBlock, LiftVariant, Session, SetRow } from '../src/data/types';
import { generateLiftDay } from '../src/engine/block/generate';
import { emojiText, onboard, pageWidth, primaryCount, seedBackup, tooSmall } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });

const now = new Date('2026-11-19T12:00:00-05:00');
const prior = '2026-11-16T15:00:00.000Z';
const previous: Session = {
  id: 'previous-lift', date: prior, endedAt: '2026-11-16T15:45:00.000Z',
  type: 'lift', variant: 'upper-a', blocks: [], hard: false, hardCardio: false, rpe: 7, durationMin: 45, notes: '',
};
const row = (exerciseId: string, equipmentId: string, idx: number): SetRow => ({
  id: `${exerciseId}:${equipmentId}:${idx}`, sessionId: previous.id, exerciseId, equipmentId, idx,
  targetWeight: 100, targetReps: 10, weight: 100, reps: 10, painFlag: false, setKind: 'working', ts: prior, rir: 3,
});
const readStore = <T,>(page: Page, store: 'sessions' | 'sets') => page.evaluate((name) => new Promise<T[]>((resolve, reject) => {
  const open = indexedDB.open('gym-plan');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const read = db.transaction(name).objectStore(name).getAll();
    read.onsuccess = () => resolve(read.result as T[]);
    read.onerror = () => reject(read.error);
    db.close();
  };
}), store);

async function setup(page: Page, { theme = 'light', runningClock = false, programStart = '2026-10-22' }: {
  theme?: 'light' | 'dark';
  runningClock?: boolean;
  programStart?: string;
} = {}) {
  if (runningClock) await page.clock.install({ time: now });
  else await page.clock.setFixedTime(now);
  await onboard(page, { activities: ['lift'] });
  const equipment = new Map(SEED_EQUIPMENT.map((entry) => [entry.id, entry]));
  const snapshot = { now: now.toISOString(), programStart, history: [], overrides: new Map(), equipment };
  // Seed each possible picked anchor so this exercises working sets after the warm-up.
  const variants: LiftVariant[] = ['upper-a', 'upper-b', 'lower-a', 'lower-b'];
  const pairs = new Map<string, { exerciseId: string; equipmentId: string }>();
  for (const variant of variants) {
    const plan = generateLiftDay(liftDayInputFrom(snapshot, variant, 60, 0));
    const main = plan.blocks.find((b) => b.kind === 'lift' && !b.warmup);
    if (main?.kind === 'lift' && main.equipmentId) pairs.set(main.exerciseId, { ...main, equipmentId: main.equipmentId });
  }
  pairs.set('chest-press-machine', { exerciseId: 'chest-press-machine', equipmentId: 'pin-stack' });
  await seedBackup(page, {
    settings: [{
      id: 'settings', goalWeightLb: 220, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
      programStart, onboardedAt: prior, updatedAt: '2026-11-20T00:00:00.000Z', backupAt: null, activities: ['lift'], appearance: theme,
    }],
    sessions: [previous],
    sets: [...pairs.values()].flatMap(({ exerciseId, equipmentId }) => [0, 1, 2].map((idx) => row(exerciseId, equipmentId, idx))),
  });
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  expect(await emojiText(page)).toEqual([]);
  await testInfo.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

async function rules(page: Page) {
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await primaryCount(page)).toBe(1);
}

const openChange = async (page: Page, id: string) => {
  await page.getByTestId('more').click();
  await page.getByTestId(`more-${id}`).click();
};

for (const theme of ['light', 'dark'] as const) {
  test(`Today matches the stored plan and takes two taps to a working set in ${theme}`, async ({ page }, testInfo) => {
    await setup(page, { theme });
    const hero = page.getByTestId('hero');
    const estimate = (await hero.innerText()).match(/\d+ min/)?.[0];
    expect(estimate).toBeDefined();
    await page.evaluate(() => {
      document.body.dataset.taps = '0';
      document.addEventListener('click', () => { document.body.dataset.taps = String(Number(document.body.dataset.taps) + 1); });
    });
    await page.getByTestId('start').click();
    await expect(page.getByTestId('plan-min')).toHaveText(`${estimate} total`);
    await page.getByTestId('warmup-done').click();
    await expect(page.getByTestId('set-done')).toBeInViewport();
    await expect(page.locator('body')).toHaveAttribute('data-taps', '2');
    await expect(page.getByTestId('up-next')).toBeVisible();
    await rules(page);
    await capture(page, testInfo, `focus-${theme}`);

    await page.locator('[data-testid^="set-weight-"]').click();
    const stepper = page.getByRole('dialog', { name: 'Edit set 1' });
    await expect(stepper).toBeVisible();
    await rules(page);
    await capture(page, testInfo, `stepper-${theme}`);
    await stepper.getByRole('button', { name: 'weight up' }).click();
    await stepper.getByRole('button', { name: 'reps up' }).click();
    await stepper.getByRole('button', { name: 'Done' }).click();
    const weight = await page.locator('[data-testid^="set-weight-"]').innerText();
    const reps = await page.locator('[data-testid^="set-reps-"]').innerText();

    await page.getByTestId('set-done').click();
    await expect(page.getByTestId('rest-timer')).toBeVisible({ timeout: 300 });
    const id = page.url().split('/').at(-1);
    expect((await readStore<SetRow>(page, 'sets')).filter((set) => set.sessionId === id))
      .toMatchObject([{ idx: 0, setKind: 'working', weight: parseFloat(weight), reps: parseInt(reps, 10) }]);
    await expect(page.getByTestId('rest-remaining')).toHaveText('2:30');
    await page.getByRole('button', { name: '+15 s' }).click();
    await expect(page.getByTestId('rest-remaining')).toHaveText('2:45');
    await page.getByRole('button', { name: '−15 s' }).click();
    await expect(page.getByTestId('rest-remaining')).toHaveText('2:30');
    await rules(page);
    await capture(page, testInfo, `rest-${theme}`);
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByTestId('rest-timer')).toHaveCount(0);
    await expect(page.locator('[data-testid^="set-weight-"][data-testid$="-1"]')).toHaveText(weight);
    await expect(page.locator('[data-testid^="set-reps-"][data-testid$="-1"]')).toHaveText(reps);
    await page.reload();
    await expect(page.locator('[data-testid^="set-weight-"][data-testid$="-1"]')).toHaveText(weight);
    await expect(page.locator('[data-testid^="set-reps-"][data-testid$="-1"]')).toHaveText(reps);
  });

  test(`a running block saves rounds, partial work and a clock-safe swap in ${theme}`, async ({ page }, testInfo) => {
    await setup(page, { theme, runningClock: true });
    await page.getByTestId('start').click();
    await page.getByTestId('warmup-done').click();
    await expect(page.getByTestId('set-done')).toBeVisible();
    const sessionId = page.url().split('/').at(-1);
    const started = (await readStore<Session>(page, 'sessions')).find((s) => s.id === sessionId)!;
    const main = started.blocks.find((b) => b.kind === 'lift' && !b.warmup);
    if (main?.kind !== 'lift') throw new Error('Expected a main lift');
    const upNextPlace = page.getByTestId('up-next').locator('li').first();
    await expect(upNextPlace).toHaveText(/^Block A · \d+ min · (turf|free weights|cardio deck|rack room|upstairs|downstairs)$/);
    const place = (await upNextPlace.innerText()).split(' · ').at(-1);
    for (let i = 0; i < main.sets; i++) {
      await expect(page.getByTestId(`set-weight-${main.exerciseId}-${i}`)).toBeVisible();
      await page.getByTestId('set-done').click();
    }
    const firstBlock = started.blocks.find((b) => b.kind === 'circuit')!;
    const storageKey = `block:${sessionId}:${firstBlock.id}`;
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ rounds: 0 })), storageKey);
    await page.getByTestId('step-next').click();
    await expect(page.getByTestId('block-screen').getByRole('heading', { level: 1 })).toHaveText(`Block A · ${place}`);
    await page.getByTestId('block-start').click();
    await page.getByTestId('round-plus').click();
    await page.getByTestId('round-plus').click();
    await expect(page.getByTestId('block-round')).toContainText('Round 3');
    const remaining = page.getByTestId('block-remaining');
    const previousTime = await remaining.textContent();
    const swap = page.locator('[data-testid^="taken-"]').first();
    const stationIndex = Number((await swap.getAttribute('data-testid'))?.split('-').at(-1));
    await swap.click();
    await expect(swap).toHaveText('Use original');
    await page.clock.runFor(5000);
    await expect(remaining).not.toHaveText(previousTime!);
    await rules(page);
    await capture(page, testInfo, `block-${theme}`);
    const beforeReload = await remaining.textContent();
    await page.reload();
    await expect(page.getByTestId('block-round')).toContainText('Round 3');
    await expect(swap).toHaveText('Use original');
    const seconds = (clock: string) => clock.split(':').reduce((n, part) => n * 60 + Number(part), 0);
    expect(seconds((await remaining.textContent())!)).toBeLessThanOrEqual(seconds(beforeReload!));
    await page.getByTestId('more').click();
    await capture(page, testInfo, `change-${theme}`);
    await page.getByTestId('more-end-block').click();
    await page.getByTestId('partial-1').click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Partial count up' }).click();
    await expect(page.getByTestId('partial-count')).toHaveText('4');
    await rules(page);
    await capture(page, testInfo, `end-${theme}`);
    await page.getByTestId('block-save').click();
    await expect.poll(async () => {
      const session = (await readStore<Session>(page, 'sessions')).find((s) => s.id === sessionId);
      return session?.blocks.find((b): b is CircuitBlock => b.kind === 'circuit')?.log;
    }).toMatchObject({ completedRounds: 2, partialReps: { stationIndex: 1, count: 4 } });
    const saved = (await readStore<Session>(page, 'sessions')).find((s) => s.id === sessionId)!;
    const first = saved.blocks.find((b): b is CircuitBlock => b.kind === 'circuit')!;
    expect(first.log?.stations[stationIndex]?.swappedFromExerciseId).toBe(first.stations[stationIndex]?.exerciseId);
    expect(first.log?.actualDurationSec).toBeGreaterThanOrEqual(5);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();

    // Discard clears all circuit keys for this session, even if a block is no longer on screen.
    const otherKey = 'block:another-session:work';
    await page.evaluate(([key, other]) => {
      localStorage.setItem(key!, '{}');
      localStorage.setItem(other!, '{}');
    }, [storageKey, otherKey]);
    await openChange(page, 'discard');
    await page.getByTestId('discard-confirm').click();
    await expect(page).toHaveURL(/#\/$/);
    expect(await page.evaluate(([key, other]) => [localStorage.getItem(key!), localStorage.getItem(other!)],
      [storageKey, otherKey])).toEqual([null, '{}']);
  });
}

test('a seeded chest press PR celebrates unless reduced motion is on', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  await page.getByTestId('warmup-done').click();
  const exercise = 'chest-press-machine';
  for (const idx of [0, 1]) {
    if (idx === 1) await page.emulateMedia({ reducedMotion: 'reduce' });
    const weight = page.getByTestId(`set-weight-${exercise}-${idx}`);
    const reps = page.getByTestId(`set-reps-${exercise}-${idx}`);
    await weight.click();
    const dialog = page.getByRole('dialog', { name: `Edit set ${idx + 1}` });
    let currentWeight = parseFloat((await weight.textContent())!);
    while (currentWeight < 105) {
      await dialog.getByRole('button', { name: 'weight up' }).click();
      const updated = parseFloat((await weight.textContent())!);
      expect(updated).toBeGreaterThan(currentWeight);
      currentWeight = updated;
    }
    const currentReps = parseInt((await reps.textContent())!, 10);
    const direction = currentReps > 10 ? 'down' : 'up';
    for (let j = 0; j < Math.abs(10 - currentReps); j++) {
      await dialog.getByRole('button', { name: `reps ${direction}` }).click();
    }
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('set-done').click();
    const banner = page.getByTestId('pr-banner');
    await expect(banner).toContainText(/PR · .* × 10/);
    await expect(banner.locator('.session-confetti')).toHaveCount(idx === 1 ? 0 : 1);
    if (idx === 0) await capture(page, testInfo, 'set-pr-light');
  }
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`Right saves RPE 7, shows the closed ring and returns to Today with ${reducedMotion}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    // Put Monday's saved lift in the same program week as Thursday's new lift.
    await setup(page, { programStart: '2026-10-19' });
    const ring = page.getByTestId('ring');
    await expect(ring).toContainText('1/2');
    await page.getByTestId('start').click();
    await page.getByTestId('warmup-done').click();
    await page.getByTestId('set-done').click();
    const id = page.url().split('/').at(-1);
    await openChange(page, 'finish-now');
    await expect(page.getByRole('dialog', { name: 'How was it?' })).toBeVisible();
    await rules(page);
    await capture(page, testInfo, reducedMotion === 'reduce' ? 'finish-reduced' : 'finish-light');
    await page.getByTestId('finish-right').click();
    const sheet = page.getByRole('dialog', { name: 'How was it?' });
    const saved = sheet.getByRole('heading', { name: 'Workout saved' });
    const fill = sheet.locator('.ring-fill');
    await expect(saved).toBeVisible();
    await expect(sheet.getByTestId('ring')).toHaveText('2/2');
    await expect(fill).toHaveAttribute('stroke-dasharray', '97 3');
    await expect(fill).toHaveCSS('--ring-fill-from', '50 50');
    await expect(fill).toHaveCSS('animation-name', reducedMotion === 'reduce' ? 'none' : 'finish-ring-fill');
    await expect(sheet.locator('.session-confetti')).toHaveCount(reducedMotion === 'reduce' ? 0 : 1);
    expect(await emojiText(page)).toEqual([]);
    await page.waitForTimeout(350);
    expect(await saved.isVisible()).toBe(true);
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
    await expect(page.locator('.warn')).toHaveCount(0);
    await expect(ring).toContainText('2/2');
    expect((await readStore<Session>(page, 'sessions')).find((s) => s.id === id)).toMatchObject({ rpe: 7 });
  });
}

test('Today resumes a recent lift across midnight and can discard a stale lift', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-19T01:00:00-05:00'));
  await onboard(page, { activities: ['lift'] });
  const recent = { ...previous, id: 'recent', date: '2026-11-19T04:00:00.000Z', endedAt: undefined };
  const stale = { ...recent, id: 'stale', date: '2026-11-17T05:30:00.000Z' };
  await seedBackup(page, { sessions: [recent, stale] });
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByTestId('start')).toHaveText('Resume');
  await page.getByTestId('start').click();
  await expect(page).toHaveURL(/#\/lift\/session\/recent$/);
  await openChange(page, 'discard');
  await page.getByTestId('discard-confirm').click();
  await page.getByTestId('stale-lift').click();
  await expect(page).toHaveURL(/#\/lift\/session\/stale$/);
  await openChange(page, 'discard');
  await page.getByTestId('discard-confirm').click();
  await expect(page.getByTestId('hero')).toBeVisible();
  expect(await readStore<Session>(page, 'sessions')).toEqual([]);
});

test('a saved lift runs in focus mode and reopens read-only after finishing', async ({ page }) => {
  await setup(page);
  await seedBackup(page, {
    templates: [{
      id: 'saved-lift', name: 'Saved lift', type: 'lift', source: 'saved', createdAt: prior,
      blocks: [{
        id: 'chest', kind: 'lift', exerciseId: 'chest-press-machine', equipmentId: 'pin-stack',
        sets: 1, repMin: 10, repMax: 10, targetWeight: 100,
      }],
    }],
  });
  await page.goto('./#/mine/saved-lift');
  await page.getByTestId('again-start').click();
  await expect(page.getByTestId('set-done')).toBeVisible();
  const sessionUrl = page.url();
  await page.getByTestId('set-done').click();
  await page.getByTestId('step-next').click();
  await page.getByTestId('finish-easy').click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  await page.goto(sessionUrl);
  await expect(page.getByRole('heading', { name: 'Finished', exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Elapsed time"]')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('100 lb × 10');
  await expect(page.locator('.primary')).toHaveCount(0);
});

test('a hybrid hands off to cardio after its lift step using the same session id', async ({ page }) => {
  await setup(page);
  await seedBackup(page, {
    sessions: [{
      ...previous, id: 'hybrid-session', date: now.toISOString(), endedAt: undefined, type: 'hybrid', hard: false, hardCardio: false, rpe: null,
      blocks: [
        { id: 'lift', kind: 'lift', exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', sets: 1, repMin: 10, repMax: 10, targetWeight: 100 },
        { id: 'run', kind: 'run', modality: 'bike', runKind: 'easy', repeats: 1, segments: [{ role: 'run', sec: 1200 }] },
      ],
    }],
  });
  await page.goto('./#/hybrid/session/hybrid-session');
  await expect(page.getByTestId('up-next')).toContainText('Bike');
  await page.getByTestId('set-done').click();
  await page.getByTestId('step-next').click();
  await expect(page.getByTestId('hybrid-next')).toContainText('Bike');
  await page.getByTestId('finish').click();
  await expect(page).toHaveURL(/#\/hybrid\/cardio\/hybrid-session$/);
});

test('the calibration route keeps the ladder and can advance to the next exercise', async ({ page }) => {
  await onboard(page, { activities: ['lift'] });
  await page.goto('./#/lift/calibrate/upper-a');
  await page.getByTestId('warmup-done').click();
  const log = page.locator('[data-testid^="cal-log-"]');
  await expect(log).toHaveCount(1);
  const exercise = (await log.getAttribute('data-testid'))?.slice('cal-log-'.length);
  await log.click();
  await page.getByTestId(`cal-3-${exercise}`).click();
  await expect(page.getByTestId(`cal-result-${exercise}`)).toBeVisible();
  await page.getByTestId('step-next').click();
  await expect(page.getByTestId(`exercise-${exercise}`)).toHaveCount(0);
});
