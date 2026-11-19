import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

test('first run: onboarding then Today with a hero and three tabs', async ({ page }) => {
  await onboard(page);
  await expect(page.getByTestId('hero')).toContainText('Lower A (calibration)');
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'first-run');
  await expect(page.getByTestId('start')).toHaveAttribute('href', '#/lift/calibrate/lower-a');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Today', 'Progress', 'Settings']);
});

test('settings backup downloads and restores into a fresh context', async ({ page, browser }, testInfo) => {
  // The second device onboards first: import keeps local settings that are newer than the file's
  // (merge rule D3), so the backup's settings must be the more recent edit to win.
  const context = await browser.newContext({ ...testInfo.project.use });
  const fresh = await context.newPage();
  await onboard(fresh, { bodyweight: '180' });

  const storedGoalOf = (p: Page) => () =>
    p.evaluate(
      () =>
        new Promise<number | undefined>((resolve) => {
          const open = indexedDB.open('gym-plan');
          open.onsuccess = () => {
            const get = open.result.transaction('settings').objectStore('settings').get('settings');
            get.onsuccess = () => { resolve((get.result as { goalWeightLb?: number } | undefined)?.goalWeightLb); open.result.close(); };
            get.onerror = () => resolve(undefined);
          };
          open.onerror = () => resolve(undefined);
        }),
    );
  // The destination edits its own goal first (older than the backup), so its input is dirty when the newer backup lands.
  await fresh.getByRole('link', { name: 'Settings' }).click();
  const freshGoal = fresh.getByLabel('Goal weight (lb)');
  await freshGoal.fill('190');
  await freshGoal.blur();
  await expect.poll(storedGoalOf(fresh), { timeout: 10_000 }).toBe(190);
  await expect(freshGoal).toHaveValue('190');

  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const goal = page.getByLabel('Goal weight (lb)');
  const storedGoal = storedGoalOf(page);
  // One real edit: fill, then blur (the browser's own `change`). The save is asynchronous, so poll the stored value
  // until it lands; nothing is ever re-filled, so a lost edit fails here.
  await goal.fill('215');
  await goal.blur();
  await expect.poll(storedGoal, { timeout: 10_000 }).toBe(215);
  await expect(goal).toHaveValue('215');
  await expect(page.getByText('Last backup: never')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const saved = testInfo.outputPath('backup.json');
  await download.saveAs(saved);
  await expect(page.getByText('Last backup: today')).toBeVisible();

  await fresh.locator('input[type=file]').setInputFiles(saved);
  await expect(fresh.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
  await expect(fresh.getByLabel('Goal weight (lb)')).toHaveValue('215');
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
  await expect(page.locator('h1')).toHaveText('gym-plan');
});

test('CSP is present and nothing violates it', async ({ page, request }) => {
  const html = await (await request.get('./')).text();
  expect(html).toContain('Content-Security-Policy');
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) violations.push(m.text());
  });
  await onboard(page, { bodyweight: '200' });
  expect(violations).toEqual([]);
});
