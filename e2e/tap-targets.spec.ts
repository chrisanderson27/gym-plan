import { expect, test, type Page } from '@playwright/test';

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function onboard(page: Page) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill('247.2');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

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
  const backup = {
    schemaVersion: 1, exportedAt: iso(now), appVersion: 'e2e',
    stores: {
      settings: [{
        id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
        programStart: localDay(new Date(now - 28 * 86_400_000)), onboardedAt: iso(now - 29 * 86_400_000), backupAt: null, updatedAt: iso(now + 60_000),
      }],
      sessions: [{
        id: sid, date: iso(now - 4 * 86_400_000), type: 'lift', variant: 'upper-a', blocks: [], hard: false, hardCardio: false, rpe: null,
        durationMin: 50, notes: '', endedAt: iso(now - 4 * 86_400_000 + 3_000_000),
      }],
      sets,
    },
  };
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
}

/**
 * Every visible button, link, select and text input is at least 56 x 56 px. A checkbox is judged by its label
 * (the whole row is the hit area); the visually hidden file input by the label button drawn around it.
 */
async function tooSmall(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select'))) {
      const isFile = el instanceof HTMLInputElement && el.type === 'file';
      const isCheck = el instanceof HTMLInputElement && el.type === 'checkbox';
      const target = isFile || isCheck ? el.closest('label') : el;
      if (!target) {
        out.push(`${el.tagName} without a label`);
        continue;
      }
      const cs = getComputedStyle(target);
      const r = target.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
      const name = `${el.tagName.toLowerCase()} "${(target.getAttribute('aria-label') ?? target.textContent ?? '').trim().slice(0, 30)}"`;
      if (r.height < 55.5) out.push(`${name} is ${Math.round(r.height)}px tall`);
      if (r.width < 55.5) out.push(`${name} is ${Math.round(r.width)}px wide`);
    }
    return out;
  });
}

/** The page never scrolls sideways: the document is no wider than the 390 px viewport. */
const pageWidth = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth);

const ROUTES = [
  '#/', '#/lift', '#/lift/volume', '#/lift/gym', '#/burn', '#/run', '#/swim', '#/swim/css',
  '#/hybrid', '#/history', '#/weigh-in', '#/builder', '#/settings',
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

test('the Home settings control is a 56 x 56 icon button named Settings', async ({ page }) => {
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
  // Log one set so the ⚠ and 💬 buttons are on screen as well.
  await page.getByTestId('set-done-chest-press-machine-0').click();
  await expect(page.getByTestId('set-chest-press-machine-0').getByTestId('feedback-set')).toBeVisible();
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

test('Feedback list reads as words, wraps long text, and never widens the page', async ({ page }) => {
  await onboardWithHistory(page);
  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();
  await page.getByTestId('feedback-exercise').first().click();
  await page.getByTestId('feedback-tag-too-easy').click();
  await page.getByLabel('Notes').fill('x'.repeat(240));
  await page.getByTestId('feedback-save').click();
  await page.goto('./#/settings');
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
  await page.getByTestId('feedback-workout').click();
  const dialog = page.getByRole('dialog', { name: 'Feedback' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(vh - 1);
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('feedback-workout').click();
  await page.getByTestId('sheet-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
});
