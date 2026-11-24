import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

const unavailableEquipment = (page: Page) => () =>
  page.evaluate(
    () =>
      new Promise<string[] | undefined>((resolve) => {
        const open = indexedDB.open('gym-plan');
        open.onsuccess = () => {
          const get = open.result.transaction('settings').objectStore('settings').get('settings');
          get.onsuccess = () => {
            resolve((get.result as { unavailableEquipment?: string[] } | undefined)?.unavailableEquipment);
            open.result.close();
          };
          get.onerror = () => resolve(undefined);
        };
        open.onerror = () => resolve(undefined);
      }),
  );

test('checklist and an exclusion survive reload', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Today', 'Workouts', 'Blocks', 'Progress', 'Settings']);
  await expect(nav.getByRole('link', { name: 'Workouts' })).toHaveAttribute('href', '#/workouts');

  const dumbbells = page.getByRole('checkbox', { name: 'Dumbbells' });
  await expect(dumbbells).toBeChecked();
  await dumbbells.click();
  await expect.poll(unavailableEquipment(page), { timeout: 10_000 }).toEqual(['dumbbells']);

  await page.getByRole('button', { name: 'Exclude an exercise' }).click();
  await page.getByRole('dialog', { name: 'Exclude an exercise' }).getByRole('button', { name: 'Leg press', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Leg press' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Dumbbells' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Remove Leg press' })).toBeVisible();
});

test('blocks is the current tab on the library', async ({ page }) => {
  await onboard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Blocks' }).click();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Blocks' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Progress' })).not.toHaveAttribute('aria-current');
});
