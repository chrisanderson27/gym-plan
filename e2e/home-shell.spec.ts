import { expect, test, type Page } from '@playwright/test';
import { openLegacyLift } from './fixtures';
import { chooseAnother, emojiText, expectTrainingInventory, localDay, onboard, pageWidth, primaryCount, seedBackup, tooSmall } from './helpers';

const now = new Date(2026, 10, 19, 12);
const date = (daysAgo: number) => new Date(2026, 10, 19 - daysAgo, 10);
const session = (id: string, daysAgo: number, type = 'lift') => ({
  id, date: date(daysAgo).toISOString(), type, blocks: [], hard: false, hardCardio: false, rpe: null,
  durationMin: 40, notes: '', endedAt: new Date(date(daysAgo).getTime() + 40 * 60_000).toISOString(),
});
const set = (sessionId: string) => ({
  id: sessionId + '-set', sessionId, exerciseId: 'chest-press-machine', equipmentId: 'pin-stack',
  idx: 0, targetWeight: 100, targetReps: 11, weight: 100, reps: 11, painFlag: false, setKind: 'working',
});
const settings = (patch: Record<string, unknown> = {}) => ({
  id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25,
  weightUnit: 'lb', distanceUnit: 'mi', programStart: localDay(date(5)), onboardedAt: date(5).toISOString(),
  backupAt: null, updatedAt: new Date(now.getTime() + 60_000).toISOString(), ...patch,
});

async function screenRules(page: Page) {
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await primaryCount(page)).toBeLessThanOrEqual(1);
  expect(await emojiText(page)).toEqual([]);
  await expect(page.locator('[data-testid^="feedback-"]:not([role="dialog"] *, [data-testid="developer"] *)')).toHaveCount(0);
}

for (const theme of ['light'] as const) {
  test(`Today states and screen rules at 390×844 in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(now);
    const capture = async (name: string) => {
      await screenRules(page);
      await page.screenshot({ scale: 'css', path: testInfo.outputPath(`${name}-${theme}.png`) });
    };
    await onboard(page);
    await capture('first-launch');

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const developer = page.getByTestId('developer');
    await expect(developer).not.toHaveAttribute('open', '');
    await capture('settings');
    await developer.locator('summary').scrollIntoViewIfNeeded();
    await capture('settings-developer-closed');
    await developer.locator('summary').click();
    await expect(developer).toHaveAttribute('open', '');
    await developer.getByText('Running as Home Screen app').scrollIntoViewIfNeeded();
    await capture('settings-developer');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page');
    await capture('progress');
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
    await capture('home-first-run');

    await page.goto('./#/swim');
    const pool = page.getByRole('dialog', { name: 'Set your pool' });
    await expect(pool).toBeVisible();
    await capture('pool');
    await pool.getByLabel('Pool unit').selectOption('m');
    await pool.getByLabel('Pool length').selectOption('custom');
    await pool.getByLabel('Custom pool length').fill('33');
    await pool.getByRole('button', { name: 'Save pool' }).click();
    await expect(pool).toHaveCount(0);
    await expect(page.getByTestId('swim-card')).toBeVisible();
    await page.getByTestId('more').click();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
    await page.screenshot({ scale: 'css', path: testInfo.outputPath(`more-${theme}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('more')).toBeFocused();

    const earlier = { ...session('earlier', 4), variant: 'upper-a' };
    await seedBackup(page, { settings: [settings({ appearance: theme })], sessions: [earlier], sets: [set(earlier.id)] });
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
    await expect(page.getByTestId('weekly-goal')).toContainText('1 of 4 sessions');
    await expect(page.getByTestId('start')).toBeInViewport();
    await capture('home-workout');

    const full = Array.from({ length: 5 }, (_, i) => session(`done-${i}`, i + 1, 'burn'));
    await seedBackup(page, { sessions: full });
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'rest');
    await expectTrainingInventory(page);
    await expect(page.locator('main .primary')).toHaveCount(0);
    await capture('home-rest');
    await chooseAnother(page);

    const done = { ...session('today', 0), variant: 'upper-a' };
    await seedBackup(page, { sessions: [done], sets: [set(done.id)] });
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('hero')).toContainText('You showed up.');
    await expect(page.getByTestId('hero')).toContainText('Upper A');
    await expect(page.getByTestId('hero')).toContainText('40 min');
    await expect(page.getByTestId('weekly-goal')).toContainText('2 of 4 sessions');
    await expect(page.locator('main')).not.toContainText('warned');
    await expect(page.locator('main .primary')).toHaveCount(1);
    await expect(page.getByTestId('hero').getByRole('link', { name: 'View progress' })).toHaveClass(/\bprimary\b/);
    await expectTrainingInventory(page);
    await capture('home-done');
  });
}

test('Progress opens History, Workouts and Blocks, with no weekly volume link', async ({ page }) => {
  await onboard(page);
  for (const [name, heading] of [
    ['All history', 'History'], ['Workouts', 'My Workouts'], ['Blocks', 'My Blocks'],
  ] as const) {
    await page.goto('./#/progress');
    await expectTrainingInventory(page);
    await page.locator('main').getByRole('link', { name, exact: true }).click();
    await expect(page.locator('main h1')).toContainText(heading);
  }
  await page.goto('./#/progress');
  await expect(page.getByTestId('progress-link-volume')).toHaveCount(0);
});

test('standalone run URLs redirect to Workouts', async ({ page }) => {
  await onboard(page);
  for (const url of ['./#/run', './#/run/long', './#/run/intervals']) {
    await page.goto(url);
    await expect(page).toHaveURL(/#\/workouts$/);
    await expect(page.getByRole('heading', { name: 'My Workouts', exact: true })).toBeVisible();
  }
});

for (const theme of ['light'] as const) {
  test(`an open legacy lift resumes from Today to its first set in ${theme}`, async ({ page }) => {
    await page.clock.setFixedTime(now);
    await onboard(page);
    const previous = { ...session('past-lift', 3), variant: 'upper-a' };
    await seedBackup(page, {
      settings: [settings({ activities: ['lift'], appearance: theme })], sessions: [previous], sets: [{ ...set(previous.id), exerciseId: 'leg-press' }],
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await seedBackup(page, { sessions: [openLegacyLift({ variant: 'lower-a', now, programStart: localDay(date(5)), history: [{ session: previous as never, sets: [{ ...set(previous.id), exerciseId: 'leg-press' } as never] }] })] });
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'resume');
    await page.evaluate(() => {
      document.body.dataset.taps = '0';
      document.addEventListener('click', () => { document.body.dataset.taps = String(Number(document.body.dataset.taps) + 1); });
    });
    await page.getByTestId('start').click();
    await expect(page).toHaveURL(/#\/lift\/session\//);
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await page.getByTestId('warmup-done').click();
    await expect(page.locator('[data-testid="set-done"], [data-testid^="cal-log-"]').first()).toBeInViewport();
    await expect(page.locator('body')).toHaveAttribute('data-taps', '2');
  });
}

test('a saved swim also asks for the pool on its first start', async ({ page }) => {
  await onboard(page);
  await seedBackup(page, {
    templates: [{
      id: 'saved-swim', name: 'Saved swim', type: 'swim', source: 'saved', createdAt: new Date().toISOString(),
      blocks: [{
        id: 'main', kind: 'swim', section: 'main', rounds: 1,
        items: [{ reps: 4, distance: 50, stroke: 'FR', swimKind: 'swim', equipment: [], mode: 'rest', intensity: 'EZ' }],
      }],
    }],
  });
  await page.goto('./#/mine/saved-swim');
  const pool = page.getByRole('dialog', { name: 'Set your pool' });
  await expect(pool).toBeVisible();
  await pool.getByRole('button', { name: 'Save pool' }).click();
  await expect(pool).toHaveCount(0);
  await expect(page.getByTestId('again-start')).toBeVisible();
});
