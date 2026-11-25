import { expect, test } from '@playwright/test';
import { onboard } from './helpers';

test('Swim: rest fallback, CSS test, then send-offs and log', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('pref-swim-open').click();
  await expect(page).toHaveURL(/#\/swim$/);
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
  await expect(page.getByRole('link', { name: 'Choose another' })).toBeVisible();
  await page.goto('./#/swim');
  await expect(page.getByText('Last swim')).toBeVisible();
});
