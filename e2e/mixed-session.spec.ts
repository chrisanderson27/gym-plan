import { expect, test, type Page } from '@playwright/test';
import { MIXED_AT, MIXED_TEMPLATE, PRIOR_LIFT, PRIOR_SET } from '../src/data/mixedSession.test-fixture';
import { settings } from '../src/data/p4-test-utils';
import { onboard, pageWidth, seedBackup, tooSmall } from './helpers';

test.beforeEach(async ({ page }) => {
  // Backup import keeps whichever settings row has the newer update timestamp.
  await page.clock.setFixedTime(Date.parse(settings().updatedAt) - 1);
  await onboard(page);
  await page.clock.setFixedTime(MIXED_AT);
});

async function startSaved(page: Page, earnedPR = true) {
  await seedBackup(page, {
    templates: [MIXED_TEMPLATE],
    settings: [settings({ programStart: '2026-07-03', activities: ['lift', 'run'] })],
    ...(earnedPR ? { sessions: [PRIOR_LIFT], sets: [PRIOR_SET] } : {}),
  }, 2);
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My workouts' })).toBeVisible();
  await page.getByRole('link', { name: 'Legs & Core' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  return page.url().split('/').pop()!;
}

async function finishTimed(page: Page, last = false) {
  await page.getByRole('button', { name: 'Start block' }).click();
  await expect(page.getByRole('button', { name: 'Finish block' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finish block' }).click();
  await page.getByRole('button', { name: last ? 'Finish workout' : 'Continue' }).click();
}

async function logSet(page: Page, weight: number, reps = 10) {
  await page.getByLabel('Weight (lb)').fill(String(weight));
  await page.getByLabel('Reps').fill(String(reps));
  await page.getByRole('button', { name: 'Log set' }).click();
}

test('saved mixed session runs offline, resumes a live swap and can reopen and rate the same finish', async ({ page, context }, info) => {
  // Move wall time while leaving IndexedDB, rendering, and timer callbacks responsive.
  let now = MIXED_AT.getTime();
  const advanceClock = async (ms: number) => {
    now += ms;
    await page.clock.setFixedTime(now);
  };
  await page.setViewportSize({ width: 402, height: 874 });
  const id = await startSaved(page);
  await finishTimed(page);
  await expect(page.getByRole('heading', { name: 'Leg press' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('strength-entry.png') });
  await logSet(page, 140);
  await expect(page.getByRole('heading', { name: 'Set 2 of 2' })).toBeVisible();
  await logSet(page, 140);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Hip thrust' })).toBeVisible();
  await logSet(page, 95);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Legs & core circuit' })).toBeVisible();
  await page.getByRole('button', { name: 'Start block' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await advanceClock(19_000);
  await expect(page.getByRole('timer')).toHaveText('07:41');
  await page.screenshot({ path: info.outputPath('3-424-live.png') });

  await expect(page.getByTestId('pose-reverse-lunge')).toBeVisible();
  await page.getByRole('button', { name: 'Swap Reverse lunge' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Step-up to box' }).click();
  await expect(page.getByTestId('pose-step-up')).toBeVisible();
  await expect(page.getByTestId('pose-reverse-lunge')).toHaveCount(0);
  await expect(page.locator('[data-exercise-id="step-up"]')).toHaveAttribute('data-equipment-id', 'dumbbells');
  await expect(page.locator('[data-exercise-id="step-up"]')).toContainText('12 reps / side');
  await expect(page.getByRole('timer')).toHaveText('07:41');

  const hasSw = await page.evaluate(() => 'serviceWorker' in navigator);
  if (hasSw) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
  } else {
    info.annotations.push({ type: 'skip-reason', description: 'no SW in Playwright WebKit' });
  }
  await page.reload();
  await expect(page).toHaveURL(new RegExp('/workout/session/' + id + '$'));
  await expect(page.getByRole('timer')).toHaveText('07:41');
  const play = page.getByRole('button', { name: 'Play Step-up to box' });
  await play.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pose-step-up')).toHaveAttribute('data-running', 'true');
  await page.getByRole('button', { name: 'Play Push-up' }).click();
  await expect(page.locator('.gym-grid [data-running="true"]')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByTestId('pose-step-up')).toHaveAttribute('data-static', 'true');
  await expect(page.getByText('Whole foot on the box')).toBeVisible();

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('circuit-paused.png') });
  await advanceClock(90_000);
  await page.reload();
  await expect(page.getByRole('timer')).toHaveText('07:41');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await advanceClock(461_000);
  await expect(page.getByRole('heading', { name: 'Review block' })).toBeFocused();
  await expect(page.getByLabel('Completed rounds')).toHaveValue('');
  await page.screenshot({ path: info.outputPath('circuit-review.png') });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review block' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recovery' })).toHaveCount(0);
  await page.getByLabel('Completed rounds').fill('2');
  await page.getByLabel('Partial station').selectOption('lunge');
  await page.getByLabel('Partial work (reps)').fill('4');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Recovery' })).toBeVisible();
  await finishTimed(page, true);
  await expect(page).toHaveURL(new RegExp('/workout/summary/' + id + '$'));
  await expect(page.getByText('Legs & Core · 5 blocks finished · 3 sets logged')).toBeVisible();
  await expect(page.getByTestId('mixed-weekly-goal')).toHaveText('2 of 3 sessions');
  await expect(page.getByTestId('mixed-pr')).toContainText('Leg press 140 × 10');
  await expect(page.getByRole('button', { name: 'Easy' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: info.outputPath('3-812-summary.png') });
  await page.getByRole('link', { name: 'Back to Today' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('link', { name: 'View progress' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('3-812-summary-scrolled.png') });
  await page.getByRole('link', { name: 'View progress' }).click();
  await page.getByRole('link', { name: 'All history' }).click();
  await page.getByTestId('history-' + id).click();
  await expect(page.getByTestId('mixed-result-circuit')).toContainText('2 rounds');
  await expect(page.getByTestId('mixed-result-circuit')).toContainText('Step-up to box · 4 reps');
  await expect(page.locator('[data-testid^="mixed-result-"]')).toHaveCount(5);
  await page.getByRole('link', { name: 'View workout summary' }).click();
  await page.getByRole('button', { name: 'Easy' }).click();
  await expect(page.getByRole('button', { name: 'Easy' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hard' }).click();
  await expect(page.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true');
});

test('unsupported movement remains readable and skipped work keeps untapped rounds unreported', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const original = MIXED_TEMPLATE.ordered!.blocks[3]!;
  if (original.kind !== 'self-paced') throw new Error('Missing circuit fixture');
  await seedBackup(page, {
    templates: [{ ...MIXED_TEMPLATE, blocks: [], ordered: {
      name: 'Long title workout for narrow viewports', blocks: [{ ...original,
        stations: [{ ...original.stations[0]!, exerciseId: 'imported-unknown-exercise-with-a-long-name' }, original.stations[1]!],
      }],
    } }],
    settings: [settings()],
  }, 2);
  await page.goto('./#/mine/' + MIXED_TEMPLATE.id);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('Movement unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start block' })).toBeDisabled();
  await expect.poll(() => pageWidth(page)).toBe(320);
  expect(await tooSmall(page)).toEqual([]);
  await page.getByRole('button', { name: 'Swap imported-unknown-exercise-with-a-long-name' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeFocused();
  await sheet.getByRole('button', { name: 'Skip station' }).click();
  await expect(page.getByText('Skipped', { exact: true })).toBeVisible();
  await finishTimed(page, true);
  await expect(page.getByTestId('mixed-summary')).toBeVisible();
  await expect(page.getByTestId('mixed-pr')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('summary-no-pr.png') });
  await page.getByRole('link', { name: 'View workout details' }).click();
  await expect(page.getByTestId('mixed-result-circuit')).toContainText('Rounds unreported');
  await expect(page.getByTestId('mixed-result-circuit')).toContainText('Skipped');
});
