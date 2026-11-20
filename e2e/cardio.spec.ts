import { expect, test } from '@playwright/test';
import { onboard } from './helpers';

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
  await onboard(page);
  await page.getByTestId('something-else-burn').click();
  await page.getByTestId('burn-change').click();
  await page.getByTestId('burn-template-burn-tread-floor').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('burn-total')).toContainText('min');
  await page.getByTestId('burn-start').click();
  await page.getByTestId('step-next').click();
  await page.getByTestId('block-start').click();

  // A clock jump must move the running block by the full elapsed time.
  const remaining = async () => mmss((await page.getByTestId('block-remaining').textContent()) ?? '0:00');
  const before = await remaining();
  await page.clock.fastForward(30_000);
  await expect.poll(async () => before - (await remaining()), { timeout: 5_000 }).toBeGreaterThanOrEqual(29);
  expect(before - (await remaining())).toBeLessThanOrEqual(31);

  await page.getByTestId('round-plus').click();
  await page.getByTestId('more').click();
  await page.getByTestId('more-end-block').click();
  await page.getByTestId('block-save').click();
  await page.getByTestId('more').click();
  await page.getByTestId('more-finish-now').click();
  await page.getByTestId('finish-right').click();
  await expect(page.getByTestId('something-else-burn')).toBeVisible();
  await page.goto('./#/burn');
  await expect(page.getByText('Last Burn')).toContainText(today());
});

test('Run: week-1 easy is run-walk within the cap and logs', async ({ page }) => {
  await onboard(page);
  await page.getByTestId('something-else-run').click();
  await page.getByTestId('run-change').click();
  await page.getByTestId('run-kind-easy').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('run-reasons')).toContainText('run-walk');
  const planned = Number(/Planned (\d+) min/.exec((await page.getByTestId('run-planned').textContent()) ?? '')?.[1]);
  expect(planned).toBeLessThanOrEqual(25);
  await page.getByTestId('run-log-direct').click();
  await page.getByTestId('run-duration').fill('25');
  await page.getByTestId('run-distance').fill('1.5');
  await page.getByTestId('rpe-4').click();
  await page.getByTestId('run-save').click();
  await expect(page.getByTestId('something-else-run')).toBeVisible();
  await page.goto('./#/run');
  await expect(page.getByText('Last run')).toBeVisible();
});

test('Swim: rest fallback, CSS test, then send-offs and log', async ({ page }) => {
  await onboard(page);
  await page.getByTestId('something-else-swim').click();
  await page.getByRole('button', { name: 'Save pool' }).click();
  await page.getByTestId('swim-change').click();
  await page.getByTestId('swim-workout-swim-css-intro').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('swim-card')).toContainText('rest');
  await expect(page.getByTestId('swim-css-prompt')).toBeVisible();

  await page.getByTestId('swim-css-prompt').getByRole('link').click();
  await page.getByLabel('400 time (m:ss)').fill('7:00');
  await page.getByLabel('200 time (m:ss)').fill('3:20');
  await page.getByTestId('css-save').click();

  await page.getByTestId('swim-change').click();
  await page.getByTestId('swim-workout-swim-css-intro').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('swim-card')).toContainText('leave every 2:05');
  await page.getByTestId('swim-log').click();
  await page.getByTestId('rpe-6').click();
  await page.getByTestId('swim-save').click();
  await expect(page.getByTestId('something-else-swim')).toBeVisible();
  await page.goto('./#/swim');
  await expect(page.getByText('Last swim')).toBeVisible();
});
