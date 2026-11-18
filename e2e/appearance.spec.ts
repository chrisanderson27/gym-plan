import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page, bodyweight: string) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill(bodyweight);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = 'rgb(244, 244, 244)';
const DARK = 'rgb(22, 22, 22)';

test('appearance: light default, dark persists across reload, system follows OS', async ({ page }) => {
  await onboard(page, '200');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvas(page)).toBe(LIGHT);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Appearance').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await canvas(page)).toBe(DARK);

  await page.addInitScript(() =>
    document.addEventListener('DOMContentLoaded', () => {
      (window as unknown as { __dcl?: string }).__dcl = document.documentElement.dataset.theme;
    }),
  );
  await page.reload();
  await expect(page.getByLabel('Appearance')).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await canvas(page)).toBe(DARK);
  expect(await page.evaluate(() => (window as unknown as { __dcl?: string }).__dcl)).toBe('dark');

  await page.getByLabel('Appearance').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  expect(await canvas(page)).toBe(DARK);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await canvas(page)).toBe(LIGHT);

  await page.getByLabel('Appearance').selectOption('light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
