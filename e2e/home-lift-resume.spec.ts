import { expect, test } from '@playwright/test';
import type { Session } from '../src/data/types';
import { chooseAnother, expectTrainingInventory, onboard, primaryCount, seedBackup } from './helpers';

test.use({ timezoneId: 'America/New_York' });

const now = new Date('2026-11-19T01:00:00-05:00');
const lift = (id: string, date: Date, variant: Session['variant']): Session => ({
  id, date: date.toISOString(), type: 'lift', variant, blocks: [], hard: false, hardCardio: false,
  rpe: null, durationMin: 0, notes: '',
});

test('returning to Today and tapping Resume keeps one unfinished lift', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await onboard(page, { activities: ['lift'] });
  await seedBackup(page, { sessions: [{
    ...lift('past-lift', new Date('2026-11-16T10:00:00-05:00'), 'upper-a'),
    endedAt: '2026-11-16T15:40:00.000Z', durationMin: 40,
  }] });
  await page.getByRole('link', { name: 'Today' }).click();
  await page.goto('./#/lift/start/lower-a');
  await page.getByTestId('start-lift').click();
  await expect(page).toHaveURL(/#\/lift\/session\/[^/]+$/);
  const sessionUrl = page.url();

  await page.goto('./#/');
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page).toHaveURL(sessionUrl);

  const unfinished = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('gym-plan');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('sessions').objectStore('sessions').getAll();
      read.onsuccess = () => resolve((read.result as Session[]).filter((s) => s.type === 'lift' && !s.endedAt).map((s) => s.id));
      read.onerror = () => reject(read.error);
      db.close();
    };
  }));
  expect(unfinished).toEqual([sessionUrl.split('/').at(-1)]);
});

test('Today shows the open lift variant and resumes that session', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await onboard(page, { activities: ['lift'] });
  // Lower B is not the ranked variant without a finished Lower A.
  await seedBackup(page, { sessions: [lift('today-lift', new Date('2026-11-19T00:15:00-05:00'), 'lower-b')] });
  await page.getByRole('link', { name: 'Today' }).click();

  await expect(page.getByTestId('hero').getByRole('heading', { name: 'Lower B', exact: true })).toBeVisible();
  await expectTrainingInventory(page);
  await chooseAnother(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  const resume = page.getByRole('link', { name: 'Resume', exact: true });
  await expect(resume).toBeVisible();
  expect(await primaryCount(page)).toBe(1);
  await resume.click();
  await expect(page).toHaveURL(/#\/lift\/session\/today-lift$/);
});

test('Today resumes an unfinished lift that started before midnight', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-18T23:30:00-05:00'));
  await onboard(page, { activities: ['lift'] });
  await seedBackup(page, { sessions: [lift('last-night', new Date('2026-11-18T23:00:00-05:00'), 'lower-b')] });
  await page.getByRole('link', { name: 'Today' }).click();
  const resume = page.getByRole('link', { name: 'Resume', exact: true });
  await expect(resume).toBeVisible();

  await page.clock.setFixedTime(now);
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'resume');
  await resume.click();
  await expect(page).toHaveURL(/#\/lift\/session\/last-night$/);
});

test('an old unfinished lift can be discarded from Today', async ({ page }) => {
  await page.clock.setFixedTime(now);
  await onboard(page, { activities: ['lift'] });
  await seedBackup(page, { sessions: [lift('old-lift', new Date('2026-11-17T00:45:00-05:00'), 'lower-b')] });
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByTestId('stale-lift').click();
  await expect(page).toHaveURL(/#\/lift\/session\/old-lift$/);
  await page.getByTestId('more').click();
  await page.getByTestId('more-discard').click();
  await page.getByTestId('discard-confirm').click();
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect(page.getByTestId('stale-lift')).toHaveCount(0);
});
