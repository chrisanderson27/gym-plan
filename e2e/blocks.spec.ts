import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { onboard, seedBackup } from './helpers';

async function addExercise(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an exercise' });
  await dialog.getByRole('button', { name, exact: false }).click();
  await expect(dialog).toHaveCount(0);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ scale: 'css' }), contentType: 'image/png' });
}

test('empty library and an empty builder', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Blocks' }).click();
  await expect(page.getByRole('heading', { name: 'My Blocks' })).toBeVisible();
  await expect(page.getByText('No saved blocks yet')).toBeVisible();
  await expect(page.getByText('Save a block from Today, try the suggested pair below, or build one from scratch.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dumbbell & core pairing' })).toBeVisible();
  await expect(page.getByText('2 stations · 8 min · Coached rotation')).toBeVisible();

  await page.getByRole('link', { name: 'New block' }).click();
  await expect(page.getByRole('button', { name: 'Save to My Blocks' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preview gym grid' })).toBeDisabled();
  await expect(page.getByLabel('Block type').locator('option:checked')).toHaveText('Self-paced circuit');
  await expect(page.getByLabel('Minutes')).toHaveValue('8');
});

test('saves a named block and reopens the same targets', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await addExercise(page, 'Leg press');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await expect(page.getByRole('dialog', { name: 'Add an exercise' }).getByRole('button', { name: 'Leg press' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await addExercise(page, 'Step-up to box');
  await addExercise(page, 'Romanian deadlift');
  await page.getByLabel('Leg press load (lb)').fill('140');
  await page.getByRole('button', { name: 'Move Step-up to box up' }).click();
  await page.getByRole('button', { name: 'Remove Romanian deadlift' }).click();
  await addExercise(page, 'Romanian deadlift');
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Step-up to box', 'Leg press', 'Romanian deadlift']);
  await expect(page.getByRole('button', { name: 'Move Step-up to box up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Romanian deadlift down' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save to My Blocks' })).toBeDisabled();
  await page.getByLabel('Block name').fill('Bench & Core');
  await expect(page.getByRole('button', { name: 'Save to My Blocks' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save to My Blocks' }).click();
  await expect(page.getByRole('heading', { name: 'My Blocks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bench & Core' })).toBeVisible();
  await expect(page.getByText('3 stations · 8 min · Self-paced circuit')).toBeVisible();
  await page.getByRole('link', { name: 'Bench & Core' }).click();
  await expect(page.getByLabel('Block name')).toHaveValue('Bench & Core');
  await expect(page.getByLabel('Minutes')).toHaveValue('8');
  await expect(page.getByRole('checkbox', { name: 'Use in workout recommendations' })).not.toBeChecked();
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Step-up to box', 'Leg press', 'Romanian deadlift']);
  await expect(page.getByLabel('Leg press target')).toHaveValue('10');
  await expect(page.getByLabel('Leg press unit')).toHaveValue('reps');
  await expect(page.getByLabel('Leg press load (lb)')).toHaveValue('140');
  await expect(page.getByLabel('Step-up to box target')).toHaveValue('8');
  await expect(page.getByLabel('Step-up to box unit')).toHaveValue('reps');
  await expect(page.getByLabel('Romanian deadlift target')).toHaveValue('8');
  await expect(page.getByLabel('Romanian deadlift unit')).toHaveValue('reps');
});

test('eligibility and targets survive a backup import', async ({ page, browser }, testInfo) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await page.getByLabel('Leg press load (lb)').fill('140');
  await page.getByRole('checkbox', { name: 'Use in workout recommendations' }).check();
  await page.getByRole('button', { name: 'Save to My Blocks' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const saved = testInfo.outputPath('blocks-backup.json');
  await download.saveAs(saved);

  const context = await browser.newContext({ ...testInfo.project.use });
  const fresh = await context.newPage();
  await onboard(fresh);
  await fresh.getByRole('link', { name: 'Settings' }).click();
  await fresh.locator('input[type=file]').setInputFiles(saved);
  await expect(fresh.getByTestId('backup-message')).toContainText('Imported');
  await fresh.getByRole('link', { name: 'Blocks' }).click();
  await fresh.getByRole('link', { name: 'Bench & Core' }).click();
  await expect(fresh.getByRole('checkbox', { name: 'Use in workout recommendations' })).toBeChecked();
  await expect(fresh.getByLabel('Leg press target')).toHaveValue('10');
  await expect(fresh.getByLabel('Leg press unit')).toHaveValue('reps');
  await expect(fresh.getByLabel('Leg press load (lb)')).toHaveValue('140');
  await context.close();
});

test('a v1 backup with no library still imports', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await page.getByRole('button', { name: 'Save to My Blocks' }).click();
  await seedBackup(page, { bodyLogs: [{ date: '2026-11-01', protein: true }] });
  await page.getByRole('link', { name: 'Blocks' }).click();
  await expect(page.getByRole('link', { name: 'Bench & Core' })).toBeVisible();
});

test('minutes and a target of 0 keep save disabled', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await page.getByLabel('Minutes').fill('0');
  await page.getByLabel('Minutes').blur();
  await expect(page.getByLabel('Minutes')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter minutes from 1 to 60.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to My Blocks' })).toBeDisabled();
  await page.getByLabel('Minutes').fill('8');
  await page.getByLabel('Minutes').blur();
  await page.getByLabel('Leg press target').fill('0');
  await page.getByLabel('Leg press target').blur();
  await expect(page.getByLabel('Leg press target')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a target greater than 0.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to My Blocks' })).toBeDisabled();
});

test('a rejected save keeps the name and shows an alert', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('gym-plan');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
  }));
  await page.getByRole('button', { name: 'Save to My Blocks' }).click();
  await expect(page.getByRole('alert')).toHaveText('Couldn\'t save this block. Try again.');
  await expect(page.getByLabel('Block name')).toHaveValue('Bench & Core');
});

test('tab stays inside the add and preview sheets', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const add = page.getByRole('dialog', { name: 'Add an exercise' });
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => {
    const dialog = document.querySelector('[aria-label="Add an exercise"]');
    const active = document.activeElement;
    return !!dialog && !!active && dialog.contains(active);
  })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(add).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeFocused();

  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await page.getByRole('button', { name: 'Preview gym grid' }).click();
  const preview = page.getByRole('dialog', { name: 'Block preview' });
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => {
    const dialog = document.querySelector('[aria-label="Block preview"]');
    const active = document.activeElement;
    return !!dialog && !!active && dialog.contains(active);
  })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview gym grid' })).toBeFocused();
});

test('preview plays one figure and reduced motion holds the strip', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await addExercise(page, 'Step-up to box');
  await addExercise(page, 'Romanian deadlift');
  await page.getByRole('button', { name: 'Preview gym grid' }).click();
  const dialog = page.getByRole('dialog', { name: 'Block preview' });
  await expect(dialog.getByRole('heading', { name: 'Leg press' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Step-up to box' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Romanian deadlift' })).toBeVisible();
  await expect(dialog.locator('[data-running=true]')).toHaveCount(1);
  await expect(dialog.locator('[data-testid="pose-leg-press"]')).toHaveAttribute('data-running', 'true');
  await dialog.getByRole('button', { name: 'Play Step-up to box' }).click();
  await expect(dialog.locator('[data-running=true]')).toHaveCount(1);
  await expect(dialog.locator('[data-testid="pose-step-up"]')).toHaveAttribute('data-running', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dialog.locator('[data-static=true]')).toHaveCount(3);
  await expect(dialog.locator('[data-running=true]')).toHaveCount(0);
});

test('preview pose is drawn while offline', async ({ page, context }) => {
  await onboard(page);
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Preview gym grid' }).click();
  await expect(page.getByRole('dialog', { name: 'Block preview' }).locator('svg.pose')).toBeVisible();
});

test('frame screenshots at week 21', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await onboard(page);
  const programStart = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 140);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Program start (week 1)').fill(programStart);
  await expect(page.locator('.week-chip')).toHaveText('Week 21');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Blocks' }).click();
  await expect(page.locator('.week-chip')).toHaveText('Week 21');
  await shot(page, testInfo, '3-3199');
  await page.getByRole('link', { name: 'New block' }).click();
  await shot(page, testInfo, '3-3395');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await shot(page, testInfo, '3-3668');
  await page.keyboard.press('Escape');
  await page.getByLabel('Block name').fill('Bench & Core');
  await addExercise(page, 'Leg press');
  await page.getByLabel('Leg press load (lb)').fill('140');
  await addExercise(page, 'Step-up to box');
  await addExercise(page, 'Romanian deadlift');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, testInfo, '3-4295');
  await page.getByRole('button', { name: 'Save to My Blocks' }).scrollIntoViewIfNeeded();
  await shot(page, testInfo, '3-4295-scrolled');
  await page.getByRole('button', { name: 'Preview gym grid' }).click();
  await shot(page, testInfo, '3-4699');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save to My Blocks' }).click();
  await expect(page.getByRole('link', { name: 'Bench & Core' })).toBeVisible();
  await shot(page, testInfo, 'populated-library');
});

test('dumbbells off keeps goblet squat and an exclusion hides leg press', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: 'Dumbbells' }).click();
  await page.goto('./#/blocks/new');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an exercise' });
  await expect(dialog.getByRole('button', { name: 'Goblet squat' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Leg press' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reverse lunge' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Exclude an exercise' }).click();
  await page.getByRole('dialog', { name: 'Exclude an exercise' }).getByRole('button', { name: 'Leg press', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Leg press' })).toBeVisible();
  await page.goto('./#/blocks/new');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  const again = page.getByRole('dialog', { name: 'Add an exercise' });
  await expect(again.getByRole('button', { name: 'Leg press' })).toHaveCount(0);
  await expect(again.getByRole('button', { name: 'Goblet squat' })).toBeVisible();
});
