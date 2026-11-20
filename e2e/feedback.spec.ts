import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { onboard, localDay, seedBackup, openFeedback } from './helpers';

test('workout feedback from More, cardio entry points, JSONL export, and the pose demo', async ({ page }, testInfo) => {
  await onboard(page);

  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const sid = '01HZZZZZZZZZZZZZZZZZZZZZZ1';
  const sets = [0, 1, 2].map((idx) => ({
    id: `01HZZZZZZZZZZZZZZZZZZZZS0${idx}`, sessionId: sid, exerciseId: 'chest-press-machine', equipmentId: 'pin-stack', idx,
    targetWeight: 100, targetReps: 11, weight: 100, reps: 11, painFlag: false, setKind: 'working', ts: iso(now - 4 * 86_400_000),
    ...(idx === 2 ? { rir: 1 } : {}),
  }));
  await seedBackup(page, {
    settings: [{
      id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
      programStart: localDay(new Date(now - 28 * 86_400_000)), onboardedAt: iso(now - 29 * 86_400_000), backupAt: null, updatedAt: iso(now + 60_000),
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
  await expect(page.getByTestId(`pose-${ex}`)).toBeVisible();

  await page.getByTestId('set-done').click();
  const sessionId = page.url().split('/').pop()!;
  await openFeedback(page);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByTestId('feedback-tag-too-easy').click();
  await page.getByLabel('Notes').fill('e2e workout note');
  await page.getByTestId('feedback-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' }).first()).toBeVisible();

  await openFeedback(page);
  await page.getByTestId('feedback-tag-adjacent-machines').click();
  await page.getByTestId('feedback-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' }).first()).toBeVisible();
  await expect(page.getByTestId('more')).toBeFocused();

  // AC2: reachable from Burn (plan and timer), run and swim.
  await page.goto('./#/burn');
  await expect(page.getByTestId('more')).toBeVisible();
  await page.getByTestId('burn-start').click();
  await expect(page.getByTestId('more')).toBeVisible();
  await page.goto('./#/run');
  await expect(page.getByTestId('more')).toBeVisible();
  await page.goto('./#/swim');
  await expect(page.getByTestId('more')).toBeVisible();

  await page.goto('./#/settings');
  await page.getByTestId('developer').locator('summary').click();
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
  expect(easy.context).toMatchObject({ sessionId });
  expect(easy.context.screen).toMatch(/^#\/lift\/session\//);

  // Reduced motion: a static filmstrip instead of the loop.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`./#/lift/session/${sessionId}`);
  await page.reload();

  await expect(page.getByTestId(`set-weight-${ex}-1`)).toBeVisible();
  await expect(page.getByTestId(`pose-${ex}`)).toHaveAttribute('data-static', 'true');
  testInfo.annotations.push({ type: 'covered', description: 'AC1 AC2 AC3' });
});
