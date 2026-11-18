import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill('247.2');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

/**
 * Every visible button, link, select and text input is at least 56 px tall. A checkbox is judged by its
 * label (the whole row is the hit area); the visually hidden file input by the label button drawn around it.
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
      if (r.height < 55.5) out.push(`${el.tagName.toLowerCase()} "${(target.textContent ?? '').trim().slice(0, 30)}" is ${Math.round(r.height)}px tall`);
    }
    return out;
  });
}

const ROUTES = [
  '#/', '#/lift', '#/lift/volume', '#/lift/gym', '#/burn', '#/run', '#/swim', '#/swim/css',
  '#/hybrid', '#/history', '#/weigh-in', '#/builder', '#/settings',
];

test('every tap target on the key screens is at least 56 px tall', async ({ page }) => {
  await onboard(page);
  for (const route of ROUTES) {
    await page.goto('./' + route);
    await expect(page.locator('main h1').first()).toBeVisible();
    expect(await tooSmall(page), route).toEqual([]);
  }
});

test('lift session: targets are 56 px tall and every set row fits on one line at 390 px', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/lift');
  await page.getByTestId('start-lift').click();
  await expect(page.locator('.setrow').first()).toBeVisible();
  expect(await tooSmall(page)).toEqual([]);
  const wrapped = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.setrow:not(.done)')).flatMap((row) => {
      const tops = Array.from(row.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top));
      const overflow = row.scrollWidth > row.clientWidth + 1;
      return new Set(tops).size > 1 || overflow ? [row.getAttribute('data-testid') ?? 'set row'] : [];
    }),
  );
  expect(wrapped).toEqual([]);
});
