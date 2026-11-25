import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { LEGACY_SUGGESTIONS } from '../src/data/workoutChoices';
import { onboard, seedBackup } from './helpers';

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const suggestions = (page: Page) => page.getByRole('region', { name: 'Suggested workouts' });
const saved = (page: Page) => page.getByRole('region', { name: 'Saved workouts' });
const openWorkouts = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' }).click();

async function goOffline(page: Page, context: BrowserContext, info: TestInfo) {
  if (!(await page.evaluate(() => 'serviceWorker' in navigator))) {
    info.annotations.push({ type: 'evidence-gap', description: 'Service worker API unavailable in this WebKit process' });
    return false;
  }
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => fetch('./not-precached-' + Date.now(), { cache: 'no-store' }).then(() => 'online', () => 'offline'))).toBe('offline');
  return true;
}

async function timed(page: Page, last = false) {
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  await page.getByRole('button', { name: last ? 'Finish workout' : /^Continue/ }).click();
}

test('a fresh offline profile lists every preset before any workout is saved', async ({ page, context }, info) => {
  await onboard(page);
  await openWorkouts(page);
  await expect(page.getByRole('heading', { name: 'My Workouts', exact: true })).toBeVisible();
  await goOffline(page, context, info);
  const cards = suggestions(page).getByRole('article');
  await expect(cards).toHaveCount(12);
  for (const card of await cards.all()) {
    await expect(card.locator('.pref-eyebrow')).toHaveText(/Strength|Conditioning|Hybrid · Run \+ strength/);
    await expect(card.locator('.workout-meta')).toContainText(/\d+ min/);
    await expect(card.locator('.workout-meta')).toContainText(/\d+ blocks/);
    await expect(card.locator('.workout-lineup')).toContainText('Warm-up');
    await expect(button(card, 'Start workout')).toBeVisible();
  }
  await expect(saved(page).getByRole('article')).toHaveCount(0);
  // Viewing never writes a row.
  expect(await page.evaluate(() => new Promise<number[]>((resolve, reject) => {
    const open = indexedDB.open('gym-plan');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const counts = ['templates', 'libraryBlocks'].map((name) => new Promise<number>((done) => {
        const request = db.transaction(name).objectStore(name).count();
        request.onsuccess = () => done(request.result);
      }));
      void Promise.all(counts).then((result) => { db.close(); resolve(result); });
    };
  }))).toEqual([0, 0]);
});

test('a hybrid preset runs its run and strength segments, logs the run and resumes', async ({ page }) => {
  test.setTimeout(90_000);
  await onboard(page);
  await openWorkouts(page);
  const card = suggestions(page).getByRole('article', { name: 'Run + Upper Strength' });
  await expect(card.locator('.pref-eyebrow')).toHaveText('Hybrid · Run + strength');
  await button(card, 'Preview').click();
  const preview = page.getByRole('dialog', { name: 'Preview Run + Upper Strength' });
  await expect(preview.getByText(/Easy · Run · 20 min planned/)).toBeVisible();
  await expect(preview.getByTestId('pose-treadmill')).toBeVisible();
  await expect(preview.locator('[data-running="true"]')).toHaveCount(1);
  await button(preview, 'Start workout').click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  const url = page.url();

  // Resume: an open short or long session always reopens.
  await page.goto('./#/');
  await page.getByTestId('hero').getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page).toHaveURL(url);

  await timed(page);
  await expect(page.getByRole('heading', { name: 'Easy run' })).toBeVisible();
  await expect(page.getByTestId('pose-treadmill')).toHaveAttribute('data-running', 'true');
  await button(page, 'Start block').click();
  const segment = page.getByTestId('run-segment');
  await expect(segment).toBeVisible();
  await expect(segment.getByRole('timer', { name: 'Segment time left' })).toBeVisible();
  await expect(page.locator('progress[aria-label="Block time left"]')).toBeVisible();
  await button(page, 'Finish block').click();
  const review = page.getByTestId('run-review');
  await review.getByLabel('Distance (mi)').fill('1.5');
  await review.getByLabel('Effort (RPE 1–10)').fill('6');
  await button(review, 'Continue').click();

  await expect(page.getByRole('heading', { name: 'Chest press machine' })).toBeVisible();
  await button(page, 'Skip block').click();
  await button(page, 'Continue').click();
  await timed(page);
  await timed(page, true);
  await expect(page.getByTestId('mixed-summary')).toBeVisible();
  await page.getByRole('link', { name: 'View workout details' }).click();
  await expect(page.locator('main')).toContainText('1.5 mi');
  await expect(page.locator('main')).toContainText('RPE 6');
});

test('a short draft shows its shortfall, and a short saved workout offers Extend', async ({ page }) => {
  await onboard(page);
  await openWorkouts(page);
  await button(page, 'New workout').click();
  const editor = page.getByRole('dialog', { name: 'Build a workout' });
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Short day');
  await button(editor, 'Add Warm-up').click();
  await expect(editor.getByRole('status')).toContainText('Add at least 40:00 to reach 45 minutes');
  await expect(button(editor, 'Save workout')).toBeDisabled();
  for (const title of ['Four-station rotation', 'Legs & core circuit', 'Easy run · 20 min']) await button(editor, 'Add ' + title).click();
  await expect(button(editor, 'Add Run intervals · 20 min')).toBeDisabled();
  await expect(editor.getByText('One running segment per workout.').first()).toBeVisible();
  await button(editor, 'Add Cool-down').click();
  await expect(editor.getByRole('status')).toContainText('Meets the 45-minute minimum');
  await button(editor, 'Save workout').click();
  await expect(saved(page).getByRole('article', { name: 'Short day' })).toBeVisible();

  const legacy = LEGACY_SUGGESTIONS[0]!;
  await seedBackup(page, { templates: [{
    id: 'old-copy', name: legacy.name, type: 'custom', source: 'saved', createdAt: '2026-11-01T12:00:00.000Z', blocks: [],
    ordered: { name: legacy.name, blocks: legacy.blocks },
  }] }, 2);
  await openWorkouts(page);
  const old = saved(page).getByRole('article', { name: legacy.name });
  await expect(old).toContainText(legacy.category);
  await expect(button(old, 'Start workout')).toHaveCount(0);
  await button(old, 'Extend to 45 min').click();
  const extend = page.getByRole('dialog', { name: 'Edit workout' });
  await expect(extend.getByRole('status')).toContainText('Add at least 6:00 to reach 45 minutes');
  await expect(button(extend, 'Save workout')).toBeDisabled();
  await button(extend, 'Add Easy run · 15 min').click();
  await expect(extend.getByRole('status')).toContainText('Meets the 45-minute minimum');
  await button(extend, 'Save workout').click();
  await expect(button(page.getByRole('dialog', { name: `Preview ${legacy.name}` }), 'Start workout')).toBeVisible();
});

test('presets show one moving figure per surface, and reduced motion shows static cues', async ({ page }) => {
  await onboard(page);
  await openWorkouts(page);
  const card = suggestions(page).getByRole('article', { name: 'Lower Strength & Core' });
  await button(card, 'Preview').click();
  const preview = page.getByRole('dialog', { name: 'Preview Lower Strength & Core' });
  await expect(preview.locator('[data-running="true"]')).toHaveCount(1);
  const pause = preview.getByRole('button', { name: /^Pause / });
  await pause.press('Enter');
  await expect(preview.locator('[data-running="true"]')).toHaveCount(0);
  await preview.getByRole('button', { name: /^Play / }).first().press('Enter');
  await expect(preview.locator('[data-running="true"]')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(preview.locator('[data-static="true"]').first()).toBeVisible();
  await expect(preview.locator('[data-running="true"]')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: /^(Play|Pause) / })).toHaveCount(0);
  await expect(preview.locator('.cues').first()).toBeVisible();
});
