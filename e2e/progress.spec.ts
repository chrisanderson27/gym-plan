import { expect, test, type Page } from '@playwright/test';
import { chooseAnother, emojiText, expectTrainingInventory, localDay, onboard, pageWidth, primaryCount, seedBackup, tooSmall } from './helpers';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 19, 12).getTime();
type Row = Record<string, unknown>;

async function seed(page: Page, stores: Record<string, Row[]>, settings: Row = {}) {
  await seedBackup(page, {
    settings: [{
      id: 'settings', goalWeightLb: 220, startWeightLb: 247.2, daysPerWeek: 5, poolUnit: 'yd', poolLength: 25,
      weightUnit: 'lb', distanceUnit: 'mi', programStart: localDay(new Date(NOW - 32 * DAY)),
      onboardedAt: new Date(NOW - 33 * DAY).toISOString(), backupAt: null,
      updatedAt: new Date(NOW + 60_000).toISOString(), ...settings,
    }],
    ...stores,
  });
}

const liftSession = (id: string, variant: string, startMs: number): Row => ({
  id, date: new Date(startMs).toISOString(), type: 'lift', variant, blocks: [], hard: false, hardCardio: false, rpe: null,
  durationMin: 50, notes: '', endedAt: new Date(startMs + 50 * 60_000).toISOString(),
});

const setsFor = (sid: string, exerciseId: string, equipmentId: string, ts: number, weight: number, reps: number): Row[] =>
  [0, 1, 2].map((idx) => ({
    id: `${sid}S${idx}`, sessionId: sid, exerciseId, equipmentId, idx, targetWeight: weight, targetReps: reps,
    weight, reps, painFlag: false, setKind: 'working', ts: new Date(ts).toISOString(), ...(idx === 2 ? { rir: 1 } : {}),
  }));

const history = {
  sessions: [
    liftSession('older', 'upper-a', NOW - 6 * DAY),
    liftSession('newer', 'upper-a', NOW - 2 * DAY),
    {
      id: 'run', type: 'run', date: new Date(NOW - 3 * DAY).toISOString(), blocks: [], durationMin: 30,
      hard: false, hardCardio: false, rpe: 5, notes: '', endedAt: new Date(NOW - 3 * DAY + 30 * 60_000).toISOString(),
    },
    {
      ...liftSession('circuit', 'upper-a', NOW - DAY),
      blocks: [{
        id: 'block', kind: 'circuit', role: 'block', podId: 'turf', durationSec: 480, targetRounds: 5,
        stations: [{ exerciseId: 'goblet-squat', target: { unit: 'reps', amount: 10 } }],
        log: {
          completedRounds: 3, partialReps: { stationIndex: 0, count: 4 }, actualDurationSec: 480,
          stations: [{ exerciseId: 'goblet-squat', swappedFromExerciseId: 'leg-press' }],
        },
      }],
    },
  ],
  sets: [
    ...setsFor('older', 'chest-press-machine', 'pin-stack', NOW - 6 * DAY, 100, 10),
    ...setsFor('newer', 'chest-press-machine', 'pin-stack', NOW - 2 * DAY, 110, 10),
  ],
  runs: [{
    sessionId: 'run', kind: 'easy', modality: 'run', distanceMi: 3, durationSec: 1800,
    intervals: [], rpe: 5, painFlag: false,
  }],
};

const bodyLogs = Array.from({ length: 20 }, (_, i) => ({
  date: localDay(new Date(NOW - (20 - i) * DAY)),
  weightLb: 252 - i / 4,
  protein: false,
}));

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await onboard(page);
});

test('seeded history renders as cards with PRs from earlier sessions', async ({ page }) => {
  await page.goto('./#/progress');
  await expect(page.getByText('No sessions yet.')).toBeVisible();
  await seed(page, {
    ...history,
    sessions: [...history.sessions,
      { ...history.sessions.find((session) => session.id === 'run'), id: 'swim', type: 'swim' },
      {
        id: 'custom', type: 'custom', date: new Date(NOW - 60_000).toISOString(), blocks: [],
        durationMin: 0, hard: false, hardCardio: false, rpe: null, notes: '',
      },
    ],
    swims: [{ sessionId: 'swim', poolLength: 25, poolUnit: 'yd', distance: 600, sets: [], rpe: 5, shoulderPainFlag: false }],
  });
  await page.goto('./#/progress');
  const newer = page.getByTestId('history-newer');
  const older = page.getByTestId('history-older');
  await expect(newer).toHaveAttribute('data-activity', 'lift');
  await expect(newer.getByTestId('pr-badge')).toBeVisible();
  await expect(older).toBeVisible();
  await expect(older.getByTestId('pr-badge')).toHaveCount(0);
  await expect(page.getByTestId('history-run')).toContainText('3 mi');
  await expect(page.getByTestId('history-swim')).toContainText('600 yd');
  const custom = page.getByTestId('history-custom');
  await expect(custom).toHaveCount(0);
  await newer.click();
  await expect(page).toHaveURL(/#\/history\/newer$/);
  await expect(page.getByTestId('detail-prs')).toContainText('110 × 10');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' }).click();
  await page.getByTestId('history-circuit').click();
  await expect(page.getByTestId('circuit-summary')).toContainText('3 rounds + 4 reps');
  await expect(page.getByText('34 reps')).toBeVisible();
  await expect(page.getByText(/Goblet squat.*swapped/i)).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' }).click();
  await page.getByTestId('progress-link-history').click();
  await expect(page).toHaveURL(/#\/progress\/history$/);
  await expect(newer.getByTestId('pr-badge')).toBeVisible();
  await expect(older).toBeVisible();
  await expect(page.getByTestId('history-run')).toContainText('3 mi');
  await expect(page.getByTestId('history-swim')).toContainText('600 yd');
  await expect(page.getByTestId('history-circuit')).toContainText('3 rounds');
  await expect(custom).toContainText('in progress');
  await expect(custom).not.toHaveAttribute('data-activity');
  await page.goto('./#/history/missing');
  await expect(page.getByRole('heading', { name: 'Session not found' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`Progress screen rules at 390×844 in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, { ...history, bodyLogs }, {
      appearance: theme, programStart: localDay(new Date(NOW - 60 * DAY)),
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [route, ready, label] of [
      ['progress', 'progress-streak', 'overview'],
      ['progress/history', 'history-newer', 'history'],
      ['progress/body', 'trend-chart', 'body'],
      ['progress/volume', 'volume-chest', 'volume'],
    ]) {
      await page.goto('./#/' + route);
      await expect(page.getByTestId(ready!)).toBeVisible();
      if (route === 'progress') {
        await expect(page.getByTestId('ring-week')).toHaveCount(8);
        await expect(page.getByTestId('history-newer')).toBeVisible();
        await expect(page.getByTestId('trend-chart')).toBeVisible();
      }
      expect(await tooSmall(page), route).toEqual([]);
      expect(await pageWidth(page), route).toBeLessThanOrEqual(390);
      expect(await primaryCount(page), route).toBeLessThanOrEqual(1);
      expect(await emojiText(page), route).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`progress-${label}-${theme}.png`), fullPage: true, scale: 'css' });
    }
    for (const [id, ready] of [['newer', 'detail-prs'], ['circuit', 'circuit-summary']]) {
      await page.goto('./#/history/' + id);
      await expect(page.getByTestId(ready!)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`progress-detail-${id}-${theme}.png`), fullPage: true, scale: 'css' });
    }
  });
}

test('the legacy weigh-in route still updates the read-only Progress trend', async ({ page }) => {
  await seed(page, { bodyLogs });
  await page.goto('./#/progress/body');
  await expect(page.getByRole('heading', { name: 'Weigh-in', exact: true })).toBeVisible();
  const line = page.getByTestId('trend-line');
  const trend = page.getByTestId('body-trend');
  await expect(line).toHaveAttribute('data-last', /\d/);
  const before = (await line.getAttribute('data-last'))!;
  const trendBefore = (await trend.textContent())!;
  await page.getByTestId('body-weight').fill(String(Number(before) - 5));
  await page.getByTestId('body-save').click();
  await expect(line).not.toHaveAttribute('data-last', before);
  await expect(trend).not.toHaveText(trendBefore);
  const after = (await line.getAttribute('data-last'))!;
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' }).click();
  const card = page.getByTestId('progress-body');
  await expect(card.getByRole('img')).toHaveAccessibleName(`Bodyweight trend ${after} lb`);
  await expect(card.getByTestId('trend-line')).toHaveAttribute('data-last', after);
  await expectTrainingInventory(page);
});

test('the legacy Builder saves a workout accessible in Workouts', async ({ page }) => {
  await page.goto('./#/builder');
  await page.getByTestId('builder-name').fill('Chest press practice');
  await page.getByTestId('builder-search').fill('chest press');
  await page.getByTestId('builder-add-chest-press-machine').click();
  await page.getByTestId('builder-save').click();
  await expect(page).toHaveURL(/#\/progress$/);
  await page.locator('main').getByRole('link', { name: 'Workouts', exact: true }).click();
  const saved = page.getByRole('article', { name: 'Chest press practice' });
  await expect(saved).toBeVisible();
  await saved.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId('builder-name')).toHaveValue('Chest press practice');
  await page.getByTestId('builder-start').click();
  await expect(page).toHaveURL(/#\/lift\/session\//);
});

test('ring history shows closed weeks and the same streak as Today', async ({ page }) => {
  const days = [17, 16, 10, 9, 1];
  await seed(page, {
    sessions: days.map((day) => liftSession(`lift-${day}`, 'upper-a', NOW - day * DAY)),
    sets: days.flatMap((day) => setsFor(`lift-${day}`, 'chest-press-machine', 'pin-stack', NOW - day * DAY, 100, 10)),
  }, { activities: ['lift'] });
  await page.getByRole('link', { name: 'Today' }).click();
  const today = page.getByTestId('streak');
  await expect(today).toContainText('2-week streak');
  const count = (await today.textContent())!.match(/\d+/)![0];
  const goal = page.getByTestId('weekly-goal');
  await expect(goal).toContainText('1 of 2 sessions');
  await expect(goal.getByRole('list', { name: 'Activity goals' })).toContainText('Lifts 1 of 2');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByTestId('progress-streak')).toHaveText(count);
  await expect(goal).toContainText('1 of 2 sessions');
  await expect(goal.getByRole('list', { name: 'Activity goals' })).toContainText('Lifts 1 of 2');
  const weeks = page.getByTestId('ring-week');
  await expect(weeks.and(page.locator('[data-state="closed"]'))).toHaveCount(2);
  const current = weeks.and(page.locator('[data-state="current"]'));
  await expect(current).toHaveCount(1);
  await expect(current.locator('.ring-track')).toHaveAttribute('stroke-dasharray', '97 3');
  await expect(current.locator('.ring-fill')).toHaveAttribute('stroke-dasharray', '50 50');
  await expect(current).toContainText('Lifts 1 of 2');

  await seed(page, {}, {
    programStart: localDay(new Date(NOW + DAY)), updatedAt: new Date(NOW + 120_000).toISOString(),
  });
  await page.goto('./#/progress');
  await expect(weeks).toHaveCount(1);
  await expect(weeks).toHaveAttribute('data-state', 'current');
});

test('old routes redirect without a Back bounce and rest links to Workouts', async ({ page }) => {
  await seed(page, {
    sessions: Array.from({ length: 5 }, (_, i) => ({
      id: `burn-${i}`, type: 'burn', date: new Date(NOW - (i + 1) * DAY).toISOString(), blocks: [],
      durationMin: 40, hard: false, hardCardio: false, rpe: null, notes: '',
      endedAt: new Date(NOW - (i + 1) * DAY + 40 * 60_000).toISOString(),
    })),
  }, { programStart: localDay(new Date(NOW - 5 * DAY)) });
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByTestId('hero-state')).toHaveAttribute('data-state', 'rest');
  await expectTrainingInventory(page);
  await chooseAnother(page);
  await page.goto('./#/history');
  await expect(page).toHaveURL(/#\/progress\/history$/);
  await page.goto('./#/weigh-in');
  await expect(page).toHaveURL(/#\/progress\/body$/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/progress\/history$/);
  await page.goto('./#/lift/volume');
  await expect(page).toHaveURL(/#\/progress\/volume$/);
});
