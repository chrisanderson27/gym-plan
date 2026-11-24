import { expect, test } from '@playwright/test';
import { onboard, seedBackup } from './helpers';

test('keeps duplicate source actions and focus on the selected snapshot after a move', async ({ page, context }) => {
  const stamp = '2026-11-22T12:00:00.000Z';
  const source = {
    id: 'tempo-circuit', kind: 'self-paced', name: 'Tempo circuit', recommend: false,
    durationSec: 480, createdAt: stamp, updatedAt: stamp,
    stations: [{ exerciseId: 'reverse-lunge', target: { unit: 'reps', amount: 8 } }],
  };
  await onboard(page);
  await seedBackup(page, { libraryBlocks: [source] }, 2);
  await page.goto('./#/workouts');
  await page.getByRole('button', { name: 'New workout', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Build a workout' });
  await editor.getByRole('textbox', { name: 'Workout name' }).fill('Independent copies');
  await editor.getByRole('button', { name: 'Add Tempo circuit', exact: true }).click();
  await editor.getByRole('button', { name: 'Tempo circuit, block 1, actions', exact: true }).click();

  const other = await context.newPage();
  try {
    await seedBackup(other, { libraryBlocks: [{ ...source, durationSec: 600, updatedAt: '2026-11-22T12:01:00.000Z' }] }, 2);
  } finally {
    await other.close();
  }
  await expect(editor.getByRole('button', { name: 'Replace with current block', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Add another', exact: true }).click();
  await editor.getByRole('button', { name: 'Move down', exact: true }).click();
  const moved = editor.getByRole('button', { name: 'Tempo circuit, block 2, actions', exact: true });
  await expect(moved).toHaveAttribute('aria-expanded', 'true');
  await expect(moved).toBeFocused();
  await editor.getByRole('button', { name: 'Remove', exact: true }).click();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  const saved = page.getByRole('article', { name: 'Independent copies', exact: true });
  await expect(saved).toContainText('10 min · 1 block');
});
