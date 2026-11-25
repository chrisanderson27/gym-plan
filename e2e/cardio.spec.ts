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
  await page.getByLabel('200 time (m:ss)').fill('0:00');
  await expect(page.getByTestId('css-save')).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('greater than 0:00');
  await page.getByLabel('200 time (m:ss)').fill('3:20');
  await page.getByTestId('css-save').click();

  await page.getByTestId('swim-change').click();
  await page.getByTestId('swim-workout-swim-css-intro').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('swim-card')).toContainText('leave every 2:05');
  await page.getByTestId('swim-log').click();
  await page.getByTestId('rpe-6').click();
  await page.getByTestId('swim-distance').fill('99999999');
  await expect(page.getByRole('alert')).toContainText('Distance must be between 1 and 20000');
  await expect(page.getByTestId('swim-save')).toBeDisabled();
  await page.getByTestId('swim-distance').fill('1000');
  await page.getByTestId('swim-save').click();
  await expect(page.getByRole('link', { name: 'Choose another' })).toBeVisible();
  await page.goto('./#/swim');
  await expect(page.getByText('Last swim')).toBeVisible();
});

test('Preferences: pool length rejects invalid values, explains, and resets to the last good one', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('pref-swim-open').click();
  await page.getByRole('button', { name: 'Save pool' }).click();
  await page.goto('./#/settings');
  const field = page.getByLabel('Pool length');
  await field.fill('25');
  await field.fill('33.3');
  await expect(page.getByRole('alert')).toContainText('Pool length must be a whole number');
  await field.fill('99999');
  await expect(page.getByRole('alert')).toContainText('between 1 and 200');
  await field.blur();
  await expect(field).toHaveValue('25');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await field.fill('50');
  await field.blur();
  await page.reload();
  await expect(page.getByLabel('Pool length')).toHaveValue('50');
  await expect(page.getByTestId('backup-card')).toBeVisible();
});
