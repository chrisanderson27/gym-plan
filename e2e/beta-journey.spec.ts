import { expect, test, type Page } from '@playwright/test';
import { onboard, persistedRows } from './helpers';

test.use({ viewport: { width: 402, height: 874 }, timezoneId: 'America/New_York' });

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

async function timed(page: Page, last = false) {
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  await page.getByRole('button', { name: last ? 'Finish workout' : /^Continue/ }).click();
}

test('Swim is reachable from Preferences, logs, and respects the toggle', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.install();
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const swimming = page.getByRole('checkbox', { name: /Swimming/ });
  await expect(swimming).toBeChecked();
  await page.getByTestId('pref-swim-open').click();
  await expect(page).toHaveURL(/#\/swim$/);
  await page.getByRole('button', { name: 'Save pool' }).click();
  await page.getByTestId('swim-start').click();
  await page.clock.fastForward(120_000);
  await page.getByTestId('swim-finish').click();
  await page.getByTestId('rpe-6').click();
  await page.getByTestId('swim-save').click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  expect((await persistedRows<{ type: string }>(page, 'sessions')).some((s) => s.type === 'swim')).toBe(true);

  await page.getByRole('link', { name: 'Settings' }).click();
  await swimming.uncheck();
  await expect(page.getByTestId('pref-swim-open')).toHaveCount(0);
  const [settings] = await persistedRows<{ poolUnit?: string; poolLength?: number }>(page, 'settings');
  expect(settings?.poolUnit).toBeTruthy();
  expect(settings?.poolLength).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a running hybrid starts from Workouts and logs its run', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await onboard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' }).click();
  const card = page.getByRole('region', { name: 'Suggested workouts' }).getByRole('article', { name: 'Run + Upper Strength' });
  await button(page, 'Preview').first().waitFor();
  await card.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preview Run + Upper Strength' }).getByRole('button', { name: 'Start workout', exact: true }).click();
  await timed(page);
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  const review = page.getByTestId('run-review');
  await review.getByLabel('Distance (mi)').fill('1.5');
  await review.getByTestId('rpe-6').click();
  await review.getByRole('button', { name: 'Continue', exact: true }).click();
  await button(page, 'Skip block').click();
  await button(page, 'Continue').click();
  await timed(page);
  await timed(page, true);
  await expect(page.getByTestId('mixed-summary')).toBeVisible();
  await page.getByRole('link', { name: 'View workout details' }).click();
  await expect(page.locator('main')).toContainText('1.5 mi');
  await expect(page.locator('main')).toContainText('RPE 6');
  expect(errors).toEqual([]);
});

test('the first launch works offline and its backup re-imports', async ({ page, browser }, info) => {
  const errors = watchErrors(page);
  await onboard(page);
  if (await page.evaluate(() => 'serviceWorker' in navigator)) {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByTestId('hero')).toBeVisible();
    await page.context().setOffline(false);
  } else {
    info.annotations.push({ type: 'evidence-gap', description: 'no service worker in this WebKit process' });
  }
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page).toHaveURL(/#\/workout\/session\//);
  await page.goto('./#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const saved = info.outputPath('backup.json');
  await download.saveAs(saved);
  const context = await browser.newContext(info.project.use);
  const fresh = await context.newPage();
  await onboard(fresh);
  await fresh.goto('./#/settings');
  await fresh.locator('input[type=file]').setInputFiles(saved);
  await expect(fresh.getByTestId('backup-message')).toContainText('Imported');
  expect((await persistedRows<{ id: string }>(fresh, 'sessions')).length).toBe((await persistedRows(page, 'sessions')).length);
  await context.close();
  expect(errors).toEqual([]);
});
