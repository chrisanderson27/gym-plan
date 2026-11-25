import { expect, test, type Page } from '@playwright/test';
import { onboard, persistedRows } from './helpers';

test('first launch opens Today with a hero and the tab bar, no setup questions', async ({ page }) => {
  await onboard(page);
  await expect(page.locator('main input')).toHaveCount(0);
  await expect(page.getByTestId('onb-act-lift')).toHaveCount(0);
  const [settings] = await persistedRows<{ goalWeightLb?: number }>(page, 'settings');
  expect(settings?.goalWeightLb).toBeUndefined();
  expect(await persistedRows(page, 'bodyLogs')).toEqual([]);
  await expect(page.getByTestId('hero')).toContainText('Lower A');
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Today', 'Workouts', 'Blocks', 'Progress', 'Settings']);
});

test('settings backup downloads and restores into a fresh context', async ({ page, browser }, testInfo) => {
  // The second device first-launches with a default row (epoch updatedAt), so the backup's settings win without any ordering trick.
  const context = await browser.newContext({ ...testInfo.project.use });
  const fresh = await context.newPage();
  await onboard(fresh);

  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  // A real edit through the UI: switch a cue off and exclude a piece of equipment, then back it up.
  await page.getByLabel('Sound cues').uncheck();
  await page.getByLabel('Dumbbells').uncheck();
  const storedOf = (p: Page) => async () => {
    const [row] = await persistedRows<{ soundCues?: boolean; unavailableEquipment?: string[]; programStart: string }>(p, 'settings');
    return JSON.stringify([row?.soundCues, row?.unavailableEquipment]);
  };
  await expect.poll(storedOf(page), { timeout: 10_000 }).toBe(JSON.stringify([false, ['dumbbells']]));
  await expect(page.getByText('Last backup: never')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const saved = testInfo.outputPath('backup.json');
  await download.saveAs(saved);
  await expect(page.getByText('Last backup: today')).toBeVisible();

  await fresh.goto('./#/settings');
  await fresh.locator('input[type=file]').setInputFiles(saved);
  await expect(fresh.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
  await expect.poll(storedOf(fresh), { timeout: 10_000 }).toBe(JSON.stringify([false, ['dumbbells']]));
  await expect(fresh.getByLabel('Sound cues')).not.toBeChecked();
  const [original] = await persistedRows<{ programStart: string }>(page, 'settings');
  const [restored] = await persistedRows<{ programStart: string }>(fresh, 'settings');
  expect(restored?.programStart).toBe(original?.programStart);
  await context.close();
});

test('offline readiness: precache, manifest and (when available) offline reload', async ({ page, request, context }) => {
  await page.goto('./');
  const mainScript = await page.locator('script[type=module]').first().getAttribute('src');
  const assetName = mainScript!.split('/').pop()!;

  const sw = await request.get('sw.js');
  expect(sw.status()).toBe(200);
  const swText = await sw.text();
  expect(swText).toContain('index.html');
  expect(swText).toContain(assetName);

  const manifest = await (await request.get('manifest.webmanifest')).json();
  expect(manifest.start_url).toBe('/gym-plan/');
  expect(manifest.scope).toBe('/gym-plan/');
  expect(manifest.display).toBe('standalone');

  const hasSw = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!hasSw) {
    test.info().annotations.push({ type: 'skip-reason', description: 'no SW in Playwright WebKit' });
    return;
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
});

test('CSP is present and nothing violates it', async ({ page, request }) => {
  const html = await (await request.get('./')).text();
  expect(html).toContain('Content-Security-Policy');
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) violations.push(m.text());
  });
  await onboard(page);
  expect(violations).toEqual([]);
});
