import { expect, test, type Locator, type Page } from '@playwright/test';
import { onboard } from './helpers';

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const countdown = (page: Page) => page.getByTestId('auto-countdown');
const current = (page: Page) => page.locator('[data-marker="Now"]');

async function startStepAndRow(page: Page) {
  await page.clock.install({ time: new Date('2026-11-22T12:00:00-05:00') });
  await onboard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' }).click();
  await button(page.getByRole('article', { name: 'Step & Row' }), 'Start workout').click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
}

test('timed blocks continue and start on their own, and a guided circuit walks its stations', async ({ page }) => {
  await startStepAndRow(page);
  // The first block always waits for the user.
  await expect(countdown(page)).toHaveCount(0);
  await button(page, 'Start block').click();

  await page.clock.runFor(420_000);
  await expect(countdown(page)).toContainText('Continuing to Step and row rotation in 10 s');
  await page.clock.runFor(10_000);
  await expect(page.getByRole('heading', { name: 'Step and row rotation' })).toBeVisible();
  await expect(countdown(page)).toContainText('Get set · starting in 15 s');
  await page.clock.runFor(15_000);
  await expect(page.getByRole('timer', { name: 'Phase time left' })).toBeVisible();
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'box-step-up');
  await page.clock.runFor(55_000);
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'seated-cable-row');

  await button(page, 'Finish block').click();
  await expect(countdown(page)).toContainText('Continuing to Strength circuit');
  await page.clock.runFor(10_000);
  await expect(page.getByRole('heading', { name: 'Strength circuit' })).toBeVisible();
  await expect(page.getByText('The timer moves you through each exercise. Pause if you need longer.')).toBeVisible();
  // Wait stops the countdown and leaves the usual Start.
  await button(page, 'Wait').click();
  await expect(countdown(page)).toHaveCount(0);
  await page.clock.runFor(30_000);
  await expect(button(page, 'Start block')).toBeVisible();
  await button(page, 'Start block').click();

  // 10 step-ups a side is 20 reps at 3 s, then a 10 s switch, before the press comes up.
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'step-up');
  await expect(page.getByRole('timer', { name: 'Phase time left' })).toHaveText('01:00');
  await expect(button(page, '+1 round')).toHaveCount(0);
  // Rounds come from the clock, so the tap counter is not shown.
  await expect(page.getByText('Rounds logged')).toHaveCount(0);
  await page.clock.runFor(60_000);
  await expect(page.locator('.mixed-phase')).toHaveText('transition');
  await page.clock.runFor(10_000);
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'seated-db-press');
  await button(page, 'Next').click();
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'dead-bug');

  await button(page, 'Finish block').click();
  await expect(page.getByText('0 full rounds completed')).toBeVisible();
  await button(page, 'Wait').click();
  for (const block of ['Row and step rotation', 'Recovery']) {
    await page.getByRole('button', { name: new RegExp(`^Continue to ${block}`) }).or(button(page, 'Continue')).first().click();
    await expect(page.getByRole('heading', { name: block })).toBeVisible();
    await button(page, 'Skip block').click();
  }
  await button(page, 'Finish workout').click();
  // The summary reports the guided circuit's counted rounds beside the rotations.
  const summary = page.getByTestId('mixed-summary');
  await expect(summary.locator('[data-testid^="mixed-result-"]')).toHaveCount(3);
  await expect(summary.locator('[data-testid="mixed-result-step-circuit"]')).toContainText('0 rounds');
});

test('a strength block waits for its sets, then the next timed block starts itself', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-22T12:00:00-05:00') });
  await onboard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' }).click();
  await button(page.getByRole('article', { name: 'Lower Strength & Core' }), 'Start workout').click();
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  await page.clock.runFor(10_000);
  // Strength never starts or finishes itself.
  await expect(page.getByRole('heading', { name: 'Leg press' })).toBeVisible();
  await expect(countdown(page)).toHaveCount(0);
  await page.clock.runFor(30_000);
  await expect(page.getByRole('heading', { name: 'Leg press' })).toBeVisible();
});
