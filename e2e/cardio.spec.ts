import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page, bodyweight: string) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill(bodyweight);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const mmss = (s: string) => {
  const [m, sec] = s.split(':').map(Number) as [number, number];
  return m * 60 + sec;
};

test('Burn class runs under a sped-up clock and logs', async ({ page }) => {
  await page.clock.install();
  await onboard(page, '247.2');
  await page.getByTestId('tile-burn').click();
  await page.getByTestId('burn-template-burn-tread-floor').click();
  await expect(page.getByTestId('burn-total')).toContainText('55 min');
  await page.getByTestId('burn-start').click();
  await page.getByTestId('timer-start').click();

  // Backgrounded for 30 s mid-interval: the display must jump, not drift.
  const remaining = async () => mmss((await page.getByTestId('timer-remaining').textContent()) ?? '0:00');
  const before = await remaining();
  await page.clock.fastForward(30_000);
  await expect.poll(async () => before - (await remaining()), { timeout: 5_000 }).toBeGreaterThanOrEqual(29);
  expect(before - (await remaining())).toBeLessThanOrEqual(31);

  const phases = new Set<string>();
  const complete = page.getByText('Session complete');
  for (let i = 0; i < 70 && !(await complete.isVisible()); i++) {
    phases.add((await page.getByTestId('timer-phase').textContent().catch(() => null)) ?? '');
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(50);
  }
  await expect(complete).toBeVisible();
  expect(phases.size).toBeGreaterThan(1);

  await page.getByTestId('rpe-8').click();
  await page.getByTestId('burn-save').click();
  await expect(page.getByTestId('tile-burn')).toBeVisible();
  await page.goto('./#/burn');
  await expect(page.getByText('Last Burn')).toContainText(today());
});

test('Run: week-1 easy is run-walk within the cap and logs', async ({ page }) => {
  await onboard(page, '247.2');
  await page.getByTestId('tile-run').click();
  await page.getByTestId('run-kind-easy').click();
  await expect(page.getByTestId('run-reasons')).toContainText('run-walk');
  const planned = Number(/Planned (\d+) min/.exec((await page.getByTestId('run-planned').textContent()) ?? '')?.[1]);
  expect(planned).toBeLessThanOrEqual(25);
  await page.getByTestId('run-log-direct').click();
  await page.getByTestId('run-duration').fill('25');
  await page.getByTestId('run-distance').fill('1.5');
  await page.getByTestId('rpe-4').click();
  await page.getByTestId('run-save').click();
  await expect(page.getByTestId('tile-run')).toBeVisible();
  await page.goto('./#/run');
  await expect(page.getByText('Last run')).toBeVisible();
});

test('Swim: rest fallback, CSS test, then send-offs and log', async ({ page }) => {
  await onboard(page, '247.2');
  await page.getByTestId('tile-swim').click();
  await page.getByTestId('swim-workout-swim-css-intro').click();
  await expect(page.getByTestId('swim-card')).toContainText('rest');
  await expect(page.getByTestId('swim-css-prompt')).toBeVisible();

  await page.getByTestId('swim-css-prompt').getByRole('link').click();
  await page.getByLabel('400 time (m:ss)').fill('7:00');
  await page.getByLabel('200 time (m:ss)').fill('3:20');
  await page.getByTestId('css-save').click();

  await expect(page.getByTestId('swim-workout-swim-css-intro')).toBeVisible();
  await page.getByTestId('swim-workout-swim-css-intro').click();
  await expect(page.getByTestId('swim-card')).toContainText('@ 2:05');
  await page.getByTestId('swim-log').click();
  await page.getByTestId('rpe-6').click();
  await page.getByTestId('swim-save').click();
  await expect(page.getByTestId('tile-swim')).toBeVisible();
  await page.goto('./#/swim');
  await expect(page.getByText('Last swim')).toBeVisible();
});
