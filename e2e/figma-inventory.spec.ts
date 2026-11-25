import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { onboard } from './helpers';

test.use({ viewport: { width: 402, height: 874 }, timezoneId: 'America/New_York' });

const FIXED = new Date('2026-11-20T12:00:00-05:00');
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

async function shot(page: Page, info: TestInfo, node: string) {
  await page.screenshot({ path: info.outputPath(`figma/${node}.png`), scale: 'css' });
  await page.screenshot({ path: info.outputPath(`figma/${node}-full.png`), fullPage: true, scale: 'css' });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED);
  await onboard(page);
});

test('1:2 Today and 5:5629 Preferences', async ({ page }, info) => {
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await shot(page, info, '1-2');
  await nav(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
  await shot(page, info, '5-5629');
});

test('3:2286 Workouts, 3:2652 editor overlay', async ({ page }, info) => {
  await nav(page, 'Workouts');
  await expect(page.getByRole('heading', { name: 'My Workouts', exact: true })).toBeVisible();
  await shot(page, info, '3-2286');
  await page.getByRole('button', { name: 'New workout', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Build a workout' })).toBeVisible();
  await shot(page, info, '3-2652');
});

test('3:3199 Blocks, 3:3395 new block, 3:3668 add exercise, 3:4295 draft, 3:4699 preview', async ({ page }, info) => {
  await nav(page, 'Blocks');
  await shot(page, info, '3-3199');
  await page.getByRole('link', { name: 'New block' }).click();
  await shot(page, info, '3-3395');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await shot(page, info, '3-3668');
  await page.keyboard.press('Escape');
  await page.getByLabel('Block name').fill('Bench & Core');
  for (const name of ['Leg press', 'Step-up to box', 'Romanian deadlift']) {
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByRole('dialog', { name: 'Add an exercise' }).getByRole('button', { name, exact: false }).click();
  }
  await shot(page, info, '3-4295');
  await page.getByRole('button', { name: 'Preview gym grid' }).click();
  await expect(page.getByRole('dialog', { name: 'Block preview' })).toBeVisible();
  await shot(page, info, '3-4699');
});

test('3:5248 Progress', async ({ page }, info) => {
  await nav(page, 'Progress');
  await expect(page.getByTestId('progress-streak')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log', exact: true })).toHaveCount(0);
  await shot(page, info, '3-5248');
});

test('2:1126 live block, 3:328/3:424 block states, 3:812 summary, 3:1039 Today done', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  await shot(page, info, '2-1126');
  await page.getByRole('button', { name: 'Start block', exact: true }).click();
  await shot(page, info, '3-328');
  await page.getByRole('button', { name: 'Finish block', exact: true }).click();
  await shot(page, info, '3-424');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const next = page.getByRole('button', { name: /^(Continue|Finish workout)/ });
    if (await page.getByTestId('mixed-summary').isVisible()) break;
    const skip = page.getByRole('button', { name: 'Skip block', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    if (await next.first().isVisible().catch(() => false)) await next.first().click();
  }
  await expect(page.getByTestId('mixed-summary')).toBeVisible();
  await shot(page, info, '3-812');
  await page.getByRole('link', { name: 'Back to Today' }).click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'done');
  await shot(page, info, '3-1039');
});
