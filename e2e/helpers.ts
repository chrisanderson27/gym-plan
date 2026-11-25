import { expect, type Page } from '@playwright/test';
import type { Activity } from '../src/engine/plan/activities';

export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface FirstLaunchOptions {
  activities?: Activity[];
}

/** First launch: the app seeds default settings and opens on Today. `activities` overwrites the stored list when given. */
export async function onboard(page: Page, { activities }: FirstLaunchOptions = {}) {
  await page.goto('./');
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
  if (!activities) return;
  await page.evaluate((list) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('gym-plan');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const read = store.get('settings');
      read.onsuccess = () => store.put({ ...read.result, activities: list, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), activities);
  await page.reload();
  await expect(page.getByTestId('hero')).toBeVisible();
}

export async function expectTrainingInventory(page: Page) {
  const main = page.locator('main');
  await expect(main.locator('input, a[href^="#/progress/body"], a[href^="#/weigh-in"], a[href^="#/builder"], a[href^="#/mine"]')).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^(Log|Burn|Lift|Run|Hybrid|Swim)$/i })).toHaveCount(0);
  const activityLinks = main.locator('a:is([href^="#/burn"], [href^="#/lift"], [href^="#/run"], [href^="#/hybrid"], [href^="#/swim"])');
  await expect(activityLinks.filter({ hasNotText: /^(Resume$|Unfinished lift from )/ })).toHaveCount(0);
}

export async function chooseAnother(page: Page) {
  const link = page.getByRole('link', { name: 'Choose another', exact: true });
  await expect(link).toHaveAttribute('href', '#/workouts');
  const box = await link.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(56);
  expect(box?.width).toBeGreaterThanOrEqual(56);
  await link.click();
  await expect(page.getByRole('heading', { name: 'My Workouts', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/workouts$/);
  await expect(page.getByRole('dialog', { name: 'Choose another' })).toHaveCount(0);
}

export async function seedBackup(page: Page, stores: Record<string, unknown[]>, schemaVersion = 1) {
  const backup = { schemaVersion, exportedAt: new Date().toISOString(), appVersion: 'e2e', stores };
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByTestId('backup-message')).toContainText('Imported');
}

export async function openFeedback(page: Page) {
  await page.getByTestId('more').click();
  await page.getByTestId('more-feedback').click();
}

/**
 * Every visible button, link, select and text input is at least 56 x 56 px. A checkbox is judged by its label
 * (the whole row is the hit area); the visually hidden file input by the label button drawn around it.
 */
export async function tooSmall(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary'))) {
      if (!el.matches('summary') && el.closest('details:not([open])')) continue;
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
export const pageWidth = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth);

export const primaryCount = (page: Page) => page.locator('.primary:visible').count();
export const emojiText = async (page: Page) => (await page.locator('body').innerText()).match(/\p{Extended_Pictographic}/gu) ?? [];

export function persistedRows<T>(page: Page, store: string) {
  return page.evaluate((name) => new Promise<T[]>((resolve, reject) => {
    const open = indexedDB.open('gym-plan');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(name);
      const read = transaction.objectStore(name).getAll();
      transaction.oncomplete = () => { db.close(); resolve(read.result as T[]); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), store);
}

/** Adds a leading inert block when a fixture is under the 45-minute Start floor. Returns the same object when no pad is needed. */
export function padToFloor<T extends { ordered?: { name: string; blocks: unknown[] } }>(template: T): T {
  const ordered = template.ordered;
  if (!ordered) return template;
  const blocks = ordered.blocks as { kind: string; durationSec?: number; sets?: number; repMax?: number; restSec?: number }[];
  const seconds = blocks.reduce((sum, b) => sum + (b.kind === 'strength'
    ? (b.sets ?? 0) * (b.repMax ?? 0) * 3 + Math.max(0, (b.sets ?? 0) - 1) * (b.restSec ?? 90) : b.durationSec ?? 0), 0);
  if (seconds >= 2700) return template;
  const pad = { id: 'floor-pad', kind: 'preparation', durationSec: Math.min(3600, 2700 - seconds), instructions: 'Easy.' };
  return { ...template, ordered: { ...ordered, blocks: [pad, ...blocks] } };
}

/** Skips the leading pad block that padToFloor adds. */
export async function skipFloorPad(page: Page) {
  await page.getByRole('button', { name: 'Skip block', exact: true }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
}
