import { expect, test, type Page } from '@playwright/test';

async function onboard(page: Page, bodyweight: string) {
  await page.goto('./');
  await page.getByLabel('Bodyweight (lb)').fill(bodyweight);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Row = Record<string, unknown>;

/** Backup-import seeding (see lifting.spec): settings.updatedAt is ahead so the file's settings win. programStart = today − 32 d is week 5, which began 4 days ago. */
async function seed(page: Page, stores: Record<string, Row[]>) {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const backup = {
    schemaVersion: 1, exportedAt: iso(now), appVersion: 'e2e',
    stores: {
      settings: [{
        id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25, weightUnit: 'lb', distanceUnit: 'mi',
        programStart: localDay(new Date(now - 32 * DAY)), onboardedAt: iso(now - 33 * DAY), backupAt: null, updatedAt: iso(now + 60_000),
      }],
      ...stores,
    },
  };
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
}

const liftSession = (id: string, variant: string, startMs: number): Row => ({
  id, date: new Date(startMs).toISOString(), type: 'lift', variant, blocks: [], hard: false, hardCardio: false, rpe: null, durationMin: 50, notes: '',
  endedAt: new Date(startMs + 50 * 60_000).toISOString(),
});
const setsFor = (sid: string, exerciseId: string, equipmentId: string, ts: number, weight: number, reps: number, rirLast = true): Row[] =>
  [0, 1, 2].map((idx) => ({
    id: `${sid}S${idx}`, sessionId: sid, exerciseId, equipmentId, idx, targetWeight: weight, targetReps: reps, weight, reps, painFlag: false, setKind: 'working',
    ts: new Date(ts).toISOString(), ...(idx === 2 && rirLast ? { rir: 1 } : {}),
  }));

test('simulated week: pick respects 48 h and the 2-hard-session cap', async ({ page }, testInfo) => {
  await onboard(page, '247.2');
  const now = Date.now();
  const burn: Row = {
    id: '01HZZZZZZZZZZZZZZZZZZZZZB1', date: new Date(now - 3.5 * DAY).toISOString(), type: 'burn', blocks: [], hard: true, hardCardio: true, rpe: null,
    durationMin: 55, notes: '', endedAt: new Date(now - 3.5 * DAY + 55 * 60_000).toISOString(),
  };
  const run: Row = {
    id: '01HZZZZZZZZZZZZZZZZZZZZZR1', date: new Date(now - 2.5 * DAY).toISOString(), type: 'run', blocks: [], hard: true, hardCardio: true, rpe: 8,
    durationMin: 25, notes: '', endedAt: new Date(now - 2.5 * DAY + 25 * 60_000).toISOString(),
  };
  const lower = liftSession('01HZZZZZZZZZZZZZZZZZZZZZL1', 'lower-a', now - 20 * HOUR);
  const upper = liftSession('01HZZZZZZZZZZZZZZZZZZZZZU1', 'upper-a', now - 6 * DAY);
  await seed(page, {
    sessions: [burn, run, lower, upper],
    runs: [{ sessionId: '01HZZZZZZZZZZZZZZZZZZZZZR1', kind: 'intervals', modality: 'run', distanceMi: 1.5, durationSec: 1500, intervals: [], rpe: 8, painFlag: false }],
    sets: [
      ...setsFor('01HZZZZZZZZZZZZZZZZZZZZZL1', 'leg-press', 'pin-stack', now - 20 * HOUR, 200, 10),
      ...setsFor('01HZZZZZZZZZZZZZZZZZZZZZU1', 'chest-press-machine', 'pin-stack', now - 6 * DAY, 100, 11),
    ],
  });

  await page.goto('./#/');
  await expect(page.getByTestId('budget-hard')).toContainText('2/2');
  const pick = page.getByTestId('tile-pick');
  await expect(pick).not.toContainText('Lower');
  await expect(pick).not.toContainText('Burn');
  await expect(pick).not.toContainText('Intervals');
  await expect(page.getByTestId('status-burn')).toContainText('blocked');
  await expect(page.getByTestId('status-lift')).not.toContainText('blocked');
  await expect(page.getByTestId('status-hybrid')).not.toContainText('blocked');

  // Marked, not hidden: a blocked lower is still reachable.
  await page.goto('./#/lift/start/lower-b');
  await expect(page.getByTestId('start-lift')).toBeVisible();
  await expect(page.getByTestId('variant-lower-b')).toHaveClass(/on/);
  testInfo.annotations.push({ type: 'covered', description: 'AC1' });
});

test('hybrid: lift then cardio is one session, with feedback', async ({ page }, testInfo) => {
  await onboard(page, '247.2');
  const now = Date.now();
  await seed(page, {
    sessions: [liftSession('01HZZZZZZZZZZZZZZZZZZZZZU1', 'upper-a', now - 4 * DAY)],
    sets: setsFor('01HZZZZZZZZZZZZZZZZZZZZZU1', 'chest-press-machine', 'pin-stack', now - 4 * DAY, 100, 11),
  });

  await page.goto('./#/');
  await page.getByTestId('tile-hybrid').click();
  await page.getByTestId('hybrid-variant-upper-a').click();
  await page.getByTestId('hybrid-start').click();
  await expect(page).toHaveURL(/\/hybrid\/session\//);
  await expect(page.getByTestId('hybrid-next')).toBeVisible();

  // Gap g5: the P5 feedback button is live inside the hybrid session.
  await page.getByTestId('feedback-workout').click();
  await page.getByTestId('feedback-tag-too-hard').click();
  await page.getByTestId('feedback-save').click();
  await expect(page.getByRole('status').filter({ hasText: 'Feedback saved' }).first()).toBeVisible();

  const ex = 'chest-press-machine';
  for (const i of [0, 1, 2]) await page.getByTestId(`set-done-${ex}-${i}`).click();
  await page.getByTestId(`rir-${ex}-1`).click();
  await page.getByTestId('finish').click();
  await expect(page).toHaveURL(/\/hybrid\/cardio\//);
  await expect(page.getByTestId('feedback-workout')).toBeVisible();
  await page.getByTestId('hybrid-log-direct').click();
  await page.getByTestId('run-duration').fill('20');
  await page.getByTestId('rpe-5').click();
  await page.getByTestId('run-save').click();
  await expect(page.getByTestId('tile-pick')).toBeVisible();

  await page.goto('./#/history');
  const first = page.locator('[data-testid^="history-"]').first();
  await expect(first).toContainText('Hybrid');
  await first.click();
  await page.getByTestId('save-mine').click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Mine' })).toBeVisible();

  await page.goto('./#/hybrid');
  await expect(page.getByTestId('mine-row')).toBeVisible();

  await page.goto('./#/history');
  await page.locator('[data-testid^="history-"]').first().click();
  await page.getByTestId('again').click();
  await page.getByTestId('again-start').click();
  await expect(page).toHaveURL(/\/hybrid\/session\//);
  testInfo.annotations.push({ type: 'covered', description: 'AC1' });
});

test('body: weigh-in shows trend and rate', async ({ page }, testInfo) => {
  await onboard(page, '247.2');
  const now = Date.now();
  // 60 days at −0.25 lb/day: the EMA needs ~6 weeks to settle on the true slope (−1.75 lb/wk).
  const rows: Row[] = Array.from({ length: 60 }, (_, k) => {
    const back = 60 - k;
    return { date: localDay(new Date(now - back * DAY)), weightLb: Math.round((246.75 + 0.25 * (back - 1)) * 100) / 100, protein: false };
  });
  await seed(page, { bodyLogs: rows });

  await page.goto('./#/weigh-in');
  await page.getByTestId('body-weight').fill('246.2');
  await page.getByTestId('body-save').click();
  await expect(page.getByTestId('body-trend')).toBeVisible();
  await expect(page.getByTestId('body-rate')).toContainText('lb/wk');
  await expect(page.getByTestId('body-rate')).toContainText('in band');
  await expect(page.getByTestId('body-eta')).toContainText('220');
  testInfo.annotations.push({ type: 'covered', description: 'AC1' });
});
