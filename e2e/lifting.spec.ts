import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page, bodyweight: string) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill(bodyweight);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('Upper A at top of range with RIR ≤ 2 raises the next Upper A by one step', async ({ page }, testInfo) => {
  await onboard(page, '247.2');

  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  // Week 5 (not 6, which deloads): past the weeks 1–2 reduced-volume period.
  const programStart = localDay(new Date(now - 28 * 86_400_000));
  const sid = '01HZZZZZZZZZZZZZZZZZZZZZZ1';
  const sets = [0, 1, 2].map((idx) => ({
    id: `01HZZZZZZZZZZZZZZZZZZZZS0${idx}`, sessionId: sid, exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', idx,
    targetWeight: 100, targetReps: 11, weight: 100, reps: 11, painFlag: false, setKind: 'working', ts: iso(now - 4 * 86_400_000),
    ...(idx === 2 ? { rir: 1 } : {}),
  }));
  const backup = {
    schemaVersion: 1,
    exportedAt: iso(now),
    appVersion: 'e2e',
    stores: {
      settings: [{
        id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
        programStart, onboardedAt: iso(now - 29 * 86_400_000), backupAt: null, updatedAt: iso(now + 60_000),
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

  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();

  const ex = 'chest-press-machine';
  await expect(page.getByTestId(`set-weight-${ex}-0`)).toHaveText('100');
  await expect(page.getByTestId(`set-reps-${ex}-0`)).toHaveText('12');
  // AC2: three working sets, not the weeks 1–2 ramp-in two.
  await expect(page.getByTestId(`set-${ex}-2`)).toBeVisible();

  for (const i of [0, 1, 2]) await page.getByTestId(`set-done-${ex}-${i}`).click();
  await page.getByTestId(`rir-${ex}-1`).click();
  await page.getByTestId('finish').click();
  await page.getByTestId('rpe-skip').click();
  await expect(page.getByTestId('tile-lift')).toBeVisible();

  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await expect(page.getByTestId(`preview-${ex}`)).toContainText('3 × 8 @ 115');

  await page.goto('./#/lift/volume');
  await expect(page.getByTestId('volume-chest')).toContainText('3');
  testInfo.annotations.push({ type: 'covered', description: 'AC1 AC2' });
});
