import { expect, test, type Page } from '@playwright/test';
import { ACTIVITIES } from '../src/engine/plan/activities';
import { emojiText, localDay, onboard, pageWidth, primaryCount, seedBackup, tooSmall } from './helpers';

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

test('onboarding needs an activity, Maintain prefills the target, and disabled Swim stays off Today', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Get started' }).click();
  for (const activity of ACTIVITIES) await page.getByTestId(`onb-act-${activity}`).click();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('Choose at least one activity.');
  await page.getByTestId('onb-act-burn').click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Bodyweight (lb)').fill('205');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Target weight (lb)')).toBeEmpty();
  await page.getByRole('button', { name: 'Maintain' }).click();
  await expect(page.getByLabel('Target weight (lb)')).toHaveValue('205');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
  await expect(page.getByTestId('hero')).toHaveAttribute('data-activity', 'burn');
  await expect(page.getByTestId('something-else-swim')).toHaveCount(0);
  await expect(page.getByTestId('ring')).toContainText('0/2');
  await page.getByTestId('something-else-burn').click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`Today states and screen rules at 390×844 in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(now);
    const capture = async (name: string) => {
      await screenRules(page);
      await page.screenshot({ scale: 'css', path: testInfo.outputPath(`${name}-${theme}.png`) });
    };
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await page.locator('html').evaluate((html, value) => html.setAttribute('data-theme', value), theme);
    await capture('onboarding-welcome');
    await page.getByRole('button', { name: 'Get started' }).click();
    await capture('onboarding-activities');
    await page.getByRole('button', { name: 'Next' }).click();
    await capture('onboarding-bodyweight');
    await page.getByLabel('Bodyweight (lb)').fill('247.2');
    await page.getByRole('button', { name: 'Next' }).click();
    await capture('onboarding-goal');
    await page.getByLabel('Target weight (lb)').fill('220');
    await page.getByRole('button', { name: 'Start' }).click();

    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Appearance').selectOption(theme);
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
    await page.getByRole('link', { name: 'Progress' }).click();
    await expect(page.getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page');
    await capture('progress');
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'first-run');
    await capture('home-first-run');

    await page.getByTestId('something-else-swim').click();
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
    await expect(page.getByTestId('ring')).toContainText('1/4');
    await expect(page.getByTestId('start')).toBeInViewport();
    await capture('home-workout');

    const full = Array.from({ length: 5 }, (_, i) => session(`done-${i}`, i + 1, 'burn'));
    await seedBackup(page, { sessions: full });
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'rest');
    await expect(page.getByRole('link', { name: 'Log weigh-in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log weigh-in' })).toHaveAttribute('href', '#/progress/body');
    await expect(page.locator('main .primary')).toHaveCount(0);
    await capture('home-rest');

    const done = { ...session('today', 0), variant: 'upper-a' };
    await seedBackup(page, { sessions: [done], sets: [set(done.id)] });
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('hero')).toContainText('Done for today');
    await expect(page.getByTestId('hero')).toContainText('Upper A · 40 min');
    await expect(page.getByTestId('ring')).toContainText('2/4');
    await expect(page.locator('main')).not.toContainText('warned');
    await expect(page.locator('main .primary')).toHaveCount(0);
    await capture('home-done');
  });
}

test('Progress opens all five destinations', async ({ page }) => {
  await onboard(page);
  for (const [id, heading] of [
    ['history', 'History'], ['weigh-in', 'Weigh-in'], ['volume', /Week \d+ volume/],
    ['builder', 'Build a session'], ['hybrid', 'Hybrid'],
  ]) {
    await page.goto('./#/progress');
    await page.getByTestId(`progress-link-${id}`).click();
    await expect(page.locator('main h1')).toContainText(heading!);
  }
});

test('run links select long and intervals directly and after an in-app route change', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/run/long');
  await expect(page.getByTestId('run-kind')).toContainText('Long');
  await page.goto('./#/run/intervals');
  await expect(page.getByTestId('run-kind')).toContainText('Intervals');
  await page.goto('./#/run');
  await expect(page.getByTestId('run-kind')).toContainText('Easy');
  await page.evaluate(() => { location.hash = '#/run/long'; });
  await expect(page.getByTestId('run-kind')).toContainText('Long');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('a 205 lb gain trend has not reached 220 lb', async ({ page }) => {
  await onboard(page, { bodyweight: '205', direction: 'gain' });
  await page.goto('./#/weigh-in');
  await expect(page.getByTestId('body-eta')).toHaveText('not trending up');
});

for (const theme of ['light', 'dark'] as const) {
  test(`2 taps to first set of the existing lift session in ${theme}`, async ({ page }) => {
    await page.clock.setFixedTime(now);
    await onboard(page);
    const previous = { ...session('past-lift', 3), variant: 'upper-a' };
    await seedBackup(page, {
      settings: [settings({ activities: ['lift'], appearance: theme })], sessions: [previous], sets: [{ ...set(previous.id), exerciseId: 'leg-press' }],
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
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
