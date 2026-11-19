import { expect, test, type Page } from '@playwright/test';
import { onboard, localDay, seedBackup, tooSmall, pageWidth, openFeedback } from './helpers';

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

test('lift session: every control is 56 x 56 and each set row is exactly two lines at 390 px', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  await expect(page.locator('.setrow').first()).toBeVisible();
  // Log one set so the pain control is present.
  await page.getByTestId('set-done-chest-press-machine-0').click();
  await expect(page.getByTestId('set-chest-press-machine-0').getByRole('button', { name: 'pain' })).toBeVisible();
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.setrow')).map((row) => {
      const tops = [...new Set(Array.from(row.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top)))];
      const lines = Array.from(row.querySelectorAll('.setline')).map((l) => ({ over: l.scrollWidth > l.clientWidth + 1, buttons: l.querySelectorAll('button').length }));
      return { id: row.getAttribute('data-testid'), lines: tops.length, setlines: lines.length, over: lines.some((l) => l.over), first: lines[0]?.buttons };
    }),
  );
  for (const r of rows) {
    expect(r.lines, `${r.id}: button lines`).toBe(2);
    expect(r.setlines, `${r.id}: set lines`).toBe(2);
    expect(r.over, `${r.id}: overflows its line`).toBe(false);
    expect(r.first, `${r.id}: line 1 holds the weight stepper`).toBe(2);
  }
});

test('superset cards keep the same two-line set rows without overflow', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/builder');
  await page.getByTestId('builder-name').fill('Pair test');
  const adds = page.locator('[data-testid^="builder-add-"]');
  await adds.nth(0).click();
  await adds.nth(1).click();
  await page.getByTestId('builder-pair-0').click();
  await page.getByTestId('builder-start').click();
  await expect(page.locator('.superset .setrow').first()).toBeVisible();
  const first = page.locator('.superset .setrow [data-testid^="set-done-"]').first();
  if (await first.count()) await first.click();
  expect(await tooSmall(page)).toEqual([]);
  expect(await pageWidth(page)).toBeLessThanOrEqual(390);
  const over = await page.evaluate(() => Array.from(document.querySelectorAll('.superset .setline')).filter((l) => l.scrollWidth > l.clientWidth + 1).length);
  expect(over).toBe(0);
});

test('a ✓ tapped in the same instant as a +/− adjust still logs the adjusted values', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  const ex = 'chest-press-machine';
  const row = (i: number) => page.getByTestId(`set-${ex}-${i}`);
  const weight = (i: number) => page.getByTestId(`set-weight-${ex}-${i}`);

  // Adjust and tick in one JS task: no re-render happens in between, the worst case for a stale handler.
  const w0 = Number(await weight(0).textContent());
  await row(0).evaluate((el) => {
    (el.querySelector('[aria-label="weight up"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="reps up"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid^="set-done-"]') as HTMLButtonElement).click();
  });
  await expect(row(0).getByTestId(`set-done-${ex}-0`)).toHaveAttribute('aria-pressed', 'true');
  expect(Number(await weight(0).textContent())).toBeGreaterThan(w0);

  // The usual human order, one tap each with no waiting between them.
  await row(1).getByRole('button', { name: 'weight up' }).click();
  await row(1).getByRole('button', { name: 'weight up' }).click();
  await row(1).getByTestId(`set-done-${ex}-1`).click();
  await expect(row(1)).toHaveClass(/done/);

  // The logged rows hold what was on screen: reload and read them back from the database.
  const shown = [Number(await weight(0).textContent()), Number(await weight(1).textContent())];
  await page.reload();
  await expect(weight(0)).toHaveText(String(shown[0]));
  await expect(weight(1)).toHaveText(String(shown[1]));
  await expect(row(0).getByTestId(`set-done-${ex}-0`)).toHaveAttribute('aria-pressed', 'true');

  // Adjust a logged set, then un-tick it straight away: it must really un-log.
  await row(1).evaluate((el) => {
    (el.querySelector('[aria-label="weight down"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid^="set-done-"]') as HTMLButtonElement).click();
  });
  await expect(row(1).getByTestId(`set-done-${ex}-1`)).toHaveAttribute('aria-pressed', 'false');
});

test('five + taps in one JS task move the weight by exactly five steps, and survive a reload', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  const ex = 'chest-press-machine';
  const row = page.getByTestId(`set-${ex}-0`);
  const weight = row.getByTestId(`set-weight-${ex}-0`);
  const reps = row.getByTestId(`set-reps-${ex}-0`);
  const w0 = Number(await weight.textContent());
  const r0 = Number(await reps.textContent());

  // One task, no render between taps. One step is whatever the equipment step is: measure it with a single tap first.
  await row.getByRole('button', { name: 'weight up' }).click();
  const step = Number(await weight.textContent()) - w0;
  expect(step).toBeGreaterThan(0);
  await row.evaluate((el) => {
    const up = el.querySelector('[aria-label="weight up"]') as HTMLButtonElement;
    const rUp = el.querySelector('[aria-label="reps up"]') as HTMLButtonElement;
    for (let i = 0; i < 5; i++) { up.click(); rUp.click(); }
    (el.querySelector('[data-testid^="set-done-"]') as HTMLButtonElement).click();
  });
  await expect(row.getByTestId(`set-done-${ex}-0`)).toHaveAttribute('aria-pressed', 'true');
  await expect(weight).toHaveText(String(w0 + 6 * step));
  await expect(reps).toHaveText(String(r0 + 5));
  await page.reload();
  await expect(weight).toHaveText(String(w0 + 6 * step));
  await expect(reps).toHaveText(String(r0 + 5));
});

test('an open sheet traps Tab inside the dialog, makes the page inert and locks scroll', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  const opener = page.getByRole('button', { name: 'Swap' }).first();
  // Bring the opener into view first (a click would scroll it there anyway), then take the scroll position to protect.
  await opener.scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(0);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Swap exercise' });
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
  expect(await page.evaluate(() => Math.round(-document.body.getBoundingClientRect().top))).toBe(y0);
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
