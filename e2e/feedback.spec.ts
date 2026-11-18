import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page, bodyweight: string) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill(bodyweight);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('feedback from set and workout, every cardio screen, JSONL export, and the pose demo', async ({ page }, testInfo) => {
  await onboard(page, '247.2');

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

  await page.goto('./#/lift');
  await page.getByTestId('variant-upper-a').click();
  await page.getByTestId('start-lift').click();

  const ex = 'chest-press-machine';
  await expect(page.getByTestId(`pose-${ex}`)).toBeVisible();

  await page.getByTestId(`set-done-${ex}-0`).click();
  const sessionId = page.url().split('/').pop()!;
  await page.getByTestId(`set-${ex}-0`).getByTestId('feedback-set').click();
  await page.getByTestId('feedback-tag-too-easy').click();
  await page.getByLabel('Notes').fill('e2e set note');
  await page.getByTestId('feedback-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' }).first()).toBeVisible();

  await page.getByTestId('feedback-workout').click();
  await page.getByTestId('feedback-tag-adjacent-machines').click();
  await page.getByTestId('feedback-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' }).first()).toBeVisible();
  await expect(page.getByTestId('feedback-exercise').first()).toBeVisible();

  // AC2: reachable from Burn (plan and timer), run and swim.
  await page.goto('./#/burn');
  await expect(page.getByTestId('feedback-workout')).toBeVisible();
  await page.getByTestId('burn-start').click();
  await expect(page.getByTestId('feedback-workout')).toBeVisible();
  await page.goto('./#/run');
  await expect(page.getByTestId('feedback-workout')).toBeVisible();
  await page.goto('./#/swim');
  await expect(page.getByTestId('feedback-workout')).toBeVisible();

  await page.goto('./#/settings');
  await expect(page.getByTestId('feedback-row')).toHaveCount(2);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download feedback (JSONL)' }).click(),
  ]);
  const saved = testInfo.outputPath('feedback.jsonl');
  await download.saveAs(saved);
  const lines = readFileSync(saved, 'utf8').split('\n').filter((l) => l.trim() !== '');
  const rows = lines.map((l) => JSON.parse(l) as { tags: string[]; context: Record<string, string> });
  expect(rows).toHaveLength(2);
  const easy = rows.find((r) => r.tags.includes('too-easy'))!;
  expect(easy.context).toMatchObject({ sessionId, exerciseId: ex, equipmentId: 'pin-stack' });
  expect(easy.context.setId).toBeTruthy();
  expect(easy.context.screen).toMatch(/^#\/lift\/session\//);

  // Reduced motion: a static filmstrip instead of the loop.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`./#/lift/session/${sessionId}`);
  await page.reload();
  await expect(page.getByTestId(`pose-${ex}`)).toHaveAttribute('data-static', 'true');
  testInfo.annotations.push({ type: 'covered', description: 'AC1 AC2 AC3' });
});
