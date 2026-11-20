import { expect, test } from '@playwright/test';
import { onboard, localDay, seedBackup } from './helpers';

test('Upper A at top of range with RIR ≤ 2 raises the next Upper A by one step', async ({ page }, testInfo) => {
  await onboard(page);

  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  // Week 5 (not 6, which deloads): past the weeks 1–2 reduced-volume period.
  // Calendar arithmetic, not 28 x 24 h of milliseconds: across a DST change that lands on the wrong day and shifts the week window.
  const d0 = new Date(now);
  const programStart = localDay(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - 28));
  const sid = '01HZZZZZZZZZZZZZZZZZZZZZZ1';
  const sets = [0, 1, 2].map((idx) => ({
    id: `01HZZZZZZZZZZZZZZZZZZZZS0${idx}`, sessionId: sid, exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', idx,
    targetWeight: 100, targetReps: 11, weight: 100, reps: 11, painFlag: false, setKind: 'working', ts: iso(now - 4 * 86_400_000),
    ...(idx === 2 ? { rir: 1 } : {}),
  }));
  await seedBackup(page, {
    settings: [{
      id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
      programStart, onboardedAt: iso(now - 29 * 86_400_000), backupAt: null, updatedAt: iso(now + 60_000),
    }],
    sessions: [{
      id: sid, date: iso(now - 4 * 86_400_000), type: 'lift', variant: 'upper-a', blocks: [], hard: false, hardCardio: false, rpe: null,
      durationMin: 50, notes: '', endedAt: iso(now - 4 * 86_400_000 + 3_000_000),
    }],
    sets,
  });

  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();

  await page.getByTestId('warmup-done').click();
  const ex = 'chest-press-machine';
  await expect(page.getByTestId(`set-weight-${ex}-0`)).toHaveText('100 lb');
  await expect(page.getByTestId(`set-reps-${ex}-0`)).toHaveText('12 reps');
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId(`set-weight-${ex}-${i}`)).toBeVisible();
    await page.getByTestId('set-done').click();
  }
  await page.getByTestId(`rir-${ex}-1`).click();
  await page.getByTestId('more').click();
  await page.getByTestId('more-finish-now').click();
  await expect(page.getByRole('dialog', { name: 'How was it?' })).toBeInViewport();
  await page.getByTestId('finish-right').click();
  await expect(page.getByTestId('hero')).toBeVisible();

  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await expect(page.getByTestId(`preview-${ex}`)).toContainText('3 × 8 @ 115');

  await page.goto('./#/lift/volume');
  await expect(page.getByTestId('volume-chest')).toContainText('3');
  testInfo.annotations.push({ type: 'covered', description: 'AC1 AC2' });
});
