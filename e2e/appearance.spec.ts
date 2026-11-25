import { expect, test, type Page } from '@playwright/test';
import { onboard, seedBackup } from './helpers';

const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = 'rgb(245, 246, 239)';

test('appearance: no control, light always, a stored dark value is ignored', async ({ page }) => {
  await onboard(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvas(page)).toBe(LIGHT);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('appearance')).toHaveCount(0);
  await expect(page.getByLabel('Appearance')).toHaveCount(0);

  await seedBackup(page, { settings: [{
    id: 'settings', daysPerWeek: 5, weightUnit: 'lb', distanceUnit: 'mi', programStart: '2026-11-01',
    onboardedAt: '2026-11-01T08:00:00.000Z', backupAt: null, updatedAt: '2099-01-01T00:00:00.000Z', appearance: 'dark',
  }] });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvas(page)).toBe(LIGHT);
  await page.getByRole('link', { name: 'Today' }).click();
  expect(await canvas(page)).toBe(LIGHT);
});
