import { expect, test, type Page } from '@playwright/test';
import { onboard, localDay, seedBackup, tooSmall, pageWidth, openFeedback, primaryCount } from './helpers';

/** Onboard, then import one finished Upper A so the chest press has history (working sets, not calibration). */
async function onboardWithHistory(page: Page) {
  await onboard(page);
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const sid = '01HZZZZZZZZZZZZZZZZZZZZZZ1';
  const sets = [0, 1, 2].map((idx) => ({
    id: `01HZZZZZZZZZZZZZZZZZZZZS0${idx}`, sessionId: sid, exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', idx,
    targetWeight: 100, targetReps: 11, weight: 100, reps: 11, painFlag: false, setKind: 'working', ts: iso(now - 4 * 86_400_000),
    ...(idx === 2 ? { rir: 1 } : {}),
  }));
  await seedBackup(page, {
    settings: [{
      id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
      programStart: localDay(new Date(now - 28 * 86_400_000)), onboardedAt: iso(now - 29 * 86_400_000), backupAt: null, updatedAt: iso(now + 60_000),
    }],
    sessions: [{
      id: sid, date: iso(now - 4 * 86_400_000), type: 'lift', variant: 'upper-a', blocks: [], hard: false, hardCardio: false, rpe: null,
      durationMin: 50, notes: '', endedAt: iso(now - 4 * 86_400_000 + 3_000_000),
    }],
    sets,
  });
}

const ROUTES = [
  '#/', '#/lift', '#/lift/volume', '#/lift/gym', '#/burn', '#/run', '#/swim', '#/swim/css',
  '#/hybrid', '#/progress', '#/history', '#/weigh-in', '#/builder', '#/settings',
];

test('every tap target on the key screens is at least 56 x 56 px and no page scrolls sideways', async ({ page }) => {
  await onboard(page);
  for (const route of ROUTES) {
    await page.goto('./' + route);
    await expect(page.locator('main h1').first()).toBeVisible();
    expect(await tooSmall(page), route).toEqual([]);
    expect(await pageWidth(page), `${route} scrollWidth`).toBeLessThanOrEqual(390);
  }
});

test('the Settings tab has a 56 x 56 minimum target', async ({ page }) => {
  await onboard(page);
  const box = await page.getByRole('link', { name: 'Settings' }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(55.5);
  expect(box!.height).toBeGreaterThanOrEqual(55.5);
});

async function openFocus(page: Page) {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  await page.getByTestId('warmup-done').click();
  await expect(page.getByTestId('set-done')).toBeVisible();
}

test('lift focus, rest, stepper and Finish sheet fit 390 px with at most one primary', async ({ page }) => {
  await openFocus(page);
  const check = async () => {
    expect(await tooSmall(page)).toEqual([]);
    expect(await pageWidth(page)).toBeLessThanOrEqual(390);
    expect(await primaryCount(page)).toBe(1);
  };
  await check();
  await page.getByTestId('set-weight-chest-press-machine-0').click();
  const dialog = page.getByRole('dialog', { name: 'Edit set 1' });
  await expect(dialog).toBeVisible();
  await check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('set-done').click();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
  await check();
  await page.getByTestId('more').click();
  await page.getByTestId('more-finish-now').click();
  await expect(page.getByRole('dialog', { name: 'How was it?' })).toBeVisible();
  await check();
});

test('a Builder superset keeps one primary and stays within the viewport', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/builder');
  await page.getByTestId('builder-name').fill('Pair test');
  await page.getByTestId('builder-search').fill('chest press');
  await page.getByTestId('builder-add-chest-press-machine').click();
  await page.getByTestId('builder-search').fill('row');
  await page.getByTestId('builder-add-seated-cable-row').click();
  await page.getByTestId('builder-pair-0').click();
  await page.getByTestId('builder-start').click();
  await expect(page).toHaveURL(/#\/lift\/session\/[^/]+$/);
  const superset = page.getByTestId(/^superset-/);
  await expect(superset).toBeVisible();
  await expect(superset.getByTestId('exercise-chest-press-machine')).toBeVisible();
  await expect(superset.getByTestId('exercise-seated-cable-row')).toBeVisible();
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await primaryCount(page)).toBe(1);
});

test('a burst of stepper taps is kept and a repeated Done logs only one set', async ({ page }) => {
  await openFocus(page);
  const ex = 'chest-press-machine';
  const weight = page.getByTestId(`set-weight-${ex}-0`);
  const reps = page.getByTestId(`set-reps-${ex}-0`);
  const read = async (locator: typeof weight) => Number.parseFloat((await locator.textContent())!);
  const w0 = await read(weight);
  const r0 = await read(reps);
  await weight.click();
  const dialog = page.getByRole('dialog', { name: 'Edit set 1' });
  const up = dialog.getByRole('button', { name: 'weight up' });
  await up.click();
  const step = await read(weight) - w0;
  expect(step).toBeGreaterThan(0);
  await dialog.evaluate((el) => {
    const weightUp = el.querySelector<HTMLButtonElement>('[aria-label="weight up"]')!;
    const repsUp = el.querySelector<HTMLButtonElement>('[aria-label="reps up"]')!;
    for (let i = 0; i < 5; i++) { weightUp.click(); repsUp.click(); }
  });
  await expect(weight).toHaveText(`${w0 + 6 * step} lb`);
  await expect(reps).toHaveText(`${r0 + 5} reps`);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('set-done').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByTestId(`set-weight-${ex}-1`)).toBeVisible();
  const sessionId = page.url().split('/').at(-1);
  const saved = await page.evaluate((id) => new Promise<unknown[]>((resolve, reject) => {
    const connection = indexedDB.open('gym-plan');
    connection.onerror = () => reject(connection.error);
    connection.onsuccess = () => {
      const db = connection.result;
      const read = db.transaction('sets').objectStore('sets').index('sessionId').getAll(id);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      db.close();
    };
  }), sessionId);
  expect(saved).toMatchObject([{ weight: w0 + 6 * step, reps: r0 + 5, idx: 0 }]);
  await page.reload();
  await page.getByTestId('warmup-done').click();

  await expect(page.getByTestId(`set-weight-${ex}-1`)).toBeVisible();
  await expect(page.getByTestId('rest-timer')).toHaveCount(0);
  await page.getByTestId('more').click();
  await page.getByTestId('more-undo-set').click();
  await expect(weight).toBeVisible();
});

test('an open sheet traps Tab inside the dialog, makes the page inert and locks scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 });
  await openFocus(page);
  const opener = page.getByTestId('set-weight-chest-press-machine-0');
  await opener.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(0);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Edit set 1' });
  await expect(dialog).toBeVisible();
  const inside = () => dialog.evaluate((el) => el.contains(document.activeElement));
  const controls = await dialog.evaluate((el) => el.querySelectorAll('a[href], button:not([disabled]), input, select, textarea').length);
  for (let i = 0; i < controls + 3; i++) {
    await page.keyboard.press('Tab');
    expect(await inside(), `Tab #${i + 1}`).toBe(true);
  }
  for (let i = 0; i < controls + 3; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside(), `Shift+Tab #${i + 1}`).toBe(true);
  }
  expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBeGreaterThan(0);

  // Scroll lock: a wheel attempt (over the backdrop) leaves the page where it was.
  // (Mobile WebKit has no mouse.wheel, so the attempt is a wheel event on the backdrop plus programmatic scrolls.)
  await page.getByTestId('sheet-backdrop').dispatchEvent('wheel', { deltaY: 400 });
  await page.evaluate(() => { window.scrollTo(0, 400); window.scrollBy(0, 400); document.scrollingElement!.scrollTop = 400; });
  // The body is pinned at the saved offset: the content still sits at the same visual position.
  expect(await page.evaluate(() => Math.round(document.body.getBoundingClientRect().top))).toBe(-y0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);
  await expect(opener).toBeFocused();
});

test('the hero title, activity and reason share one left edge', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/');
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'workout');
  const lefts = await page.getByTestId('hero').locator('h2, p').evaluateAll(
    (nodes) => nodes.map((node) => node.getBoundingClientRect().left),
  );
  expect(lefts.length).toBeGreaterThan(1);
  for (const left of lefts) expect(left).toBeCloseTo(lefts[0]!);
});

test('Feedback list reads as words, wraps long text, and never widens the page', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  await openFeedback(page);
  await page.getByTestId('feedback-tag-too-easy').click();
  await page.getByLabel('Notes').fill('x'.repeat(240));
  await page.getByTestId('feedback-save').click();
  await page.goto('./#/settings');
  await page.getByTestId('developer').locator('summary').click();
  const row = page.getByTestId('feedback-row').first();
  await expect(row).toBeVisible();
  const text = (await row.textContent()) ?? '';
  expect(text).toContain('Lift session');
  expect(text).not.toMatch(/session 0|#\/|[0-9A-Z]{26}/);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  expect(await tooSmall(page)).toEqual([]);
});

test('sheets open as a bottom overlay, take focus, and close on Escape or the backdrop', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  await openFeedback(page);
  const dialog = page.getByRole('dialog', { name: 'Feedback' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(vh - 1);
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await openFeedback(page);
  await page.getByTestId('sheet-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
});
