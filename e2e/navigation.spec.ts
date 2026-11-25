import { expect, test } from '@playwright/test';
import { isLegacyResumeRoute, isMappedRoute } from '../src/ui/progress/routes';
import { expectTrainingInventory, localDay, onboard, persistedRows, seedBackup } from './helpers';

test.use({ viewport: { width: 402, height: 874 }, timezoneId: 'America/New_York' });

const OLD_URLS: [string, RegExp][] = [
  ['#/history', /#\/progress\/history$/], ['#/weigh-in', /#\/progress$/], ['#/progress/body', /#\/progress$/],
  ['#/lift/volume', /#\/progress$/], ['#/progress/volume', /#\/progress$/], ['#/lift/gym', /#\/settings$/],
  ['#/lift', /#\/$/], ['#/lift/start/lower-a', /#\/$/], ['#/lift/calibrate/upper-a', /#\/$/],
  ['#/burn', /#\/workouts$/], ['#/run', /#\/workouts$/], ['#/run/long', /#\/workouts$/], ['#/hybrid', /#\/workouts$/],
  ['#/builder', /#\/workouts$/], ['#/builder/abc', /#\/mine\/abc$/], ['#/swim/other', /#\/swim$/],
  ['#/lift/session/', /#\/$/], ['#/nope', /#\/$/],
];

test('fresh first launch opens Today with no setup questions', async ({ page }) => {
  await onboard(page);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
  await expect(page.locator('main input')).toHaveCount(0);
  await expect(page.locator('[data-testid^="onb-act-"]')).toHaveCount(0);
  expect(await persistedRows(page, 'bodyLogs')).toEqual([]);
  const [settings] = await persistedRows<{ goalWeightLb?: number }>(page, 'settings');
  expect(settings?.goalWeightLb).toBeUndefined();
});

test('crawling the navigation only reaches mapped surfaces', async ({ page }, testInfo) => {
  await onboard(page);
  await seedBackup(page, {
    bodyLogs: [{ date: localDay(new Date()), weightLb: 200, protein: false }],
    templates: [{
      id: 'legacy-lift', name: 'Old lift', type: 'lift', source: 'saved', createdAt: new Date().toISOString(),
      blocks: [{ id: 'c', kind: 'lift', exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', sets: 1, repMin: 10, repMax: 10, targetWeight: 100 }],
    }],
  });
  const seen = new Set<string>();
  const queue = ['#/', '#/workouts', '#/blocks', '#/progress', '#/settings'];
  const done = new Set<string>();
  while (queue.length && done.size < 60) {
    const href = queue.shift()!;
    if (done.has(href)) continue;
    done.add(href);
    await page.goto('./' + href);
    await page.waitForTimeout(150);
    const route = new URL(page.url()).hash.slice(1) || '/';
    expect(isMappedRoute(route), `${href} landed on ${route}`).toBe(true);
    expect(isLegacyResumeRoute(route), `${href} landed on ${route}`).toBe(false);
    seen.add(route);
    for (const link of await page.locator('a[href^="#/"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')!))) {
      if (!done.has(link)) queue.push(link);
    }
  }
  await testInfo.attach('crawl.json', { body: JSON.stringify([...seen].sort()), contentType: 'application/json' });
  for (const href of ['./#/', './#/progress']) {
    await page.goto(href);
    await expectTrainingInventory(page);
  }
});

test('old URLs redirect without a Back bounce', async ({ page }) => {
  await onboard(page);
  for (const [url, expected] of OLD_URLS) {
    await page.goto('./#/progress');
    await page.goto('./' + url);
    await expect(page, url).toHaveURL(expected);
    await page.goBack();
    await expect(page, `back from ${url}`).toHaveURL(/#\/progress$/);
  }
});

test('removed options are gone from Preferences and Progress', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  await expect(page.getByTestId('appearance')).toHaveCount(0);
  for (const text of ['Goals', 'Activities', 'Program start', 'Running']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Swimming/ })).toBeVisible();
  await expect(page.locator('main input[inputmode=decimal]')).toHaveCount(0);
  await page.goto('./#/progress');
  await expect(page.getByTestId('progress-link-volume')).toHaveCount(0);
  await expect(page.locator('main input')).toHaveCount(0);
});

test('an open legacy lift still resumes from Today and leaves through Today', async ({ page }) => {
  await onboard(page);
  await seedBackup(page, { sessions: [{
    id: 'open-legacy', date: new Date().toISOString(), type: 'lift', variant: 'lower-a', blocks: [], hard: false, hardCardio: false,
    rpe: null, durationMin: 0, notes: '',
  }] });
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page).toHaveURL(/#\/lift\/session\/open-legacy$/);
  await page.goto('./#/lift/session/missing-id');
  await page.getByRole('link', { name: 'Back to Today' }).click();
  await expect(page).toHaveURL(/#\/$/);
});
