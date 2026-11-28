import { expect, test, type Page } from '@playwright/test';
import { COACHED_TEMPLATE, MIXED_AT, PRIOR_LIFT, PRIOR_SET } from '../src/data/mixedSession.test-fixture';
import { settings } from '../src/data/p4-test-utils';
import type { Template } from '../src/data/types';
import { onboard, padToFloor, pageWidth, seedBackup, skipFloorPad, tooSmall } from './helpers';

const at = (ms: number) => MIXED_AT.getTime() + ms;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const phase = (page: Page) => page.getByRole('timer', { name: 'Phase time left' });
const total = (page: Page) => page.getByRole('timer', { name: 'Block time left' });
const current = (page: Page) => page.locator('[data-marker="Now"]');
const blockTitle = 'Four-station rotation';

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, scale: 'css' });
}

async function seed(page: Page, source = COACHED_TEMPLATE, prefs: Parameters<typeof settings>[0] = {}) {
  const template = padToFloor(source);
  await page.clock.setFixedTime(Date.parse(settings().updatedAt) - 1);
  await onboard(page);
  await page.clock.setFixedTime(MIXED_AT);
  await seedBackup(page, {
    templates: [template], sessions: [PRIOR_LIFT], sets: [PRIOR_SET],
    settings: [settings({ programStart: '2026-07-03', ...prefs })],
  }, 2);
  await page.goto('./#/mine/' + template.id);
  await button(page, 'Start').click();
  if (template !== source) await skipFloorPad(page);
}

async function finishTimed(page: Page, finish = false) {
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  // A guided circuit ends on the rotation-style review, whose Continue names the next block.
  await page.getByRole('button', { name: finish ? 'Finish workout' : /^Continue( to |$)/ }).click();
}

async function rotationEntry(page: Page) {
  await seed(page);
  await finishTimed(page);
  for (let i = 1; i <= 2; i++) {
    await expect(page.getByRole('heading', { name: `Set ${i} of 2` })).toBeVisible();
    await page.getByLabel('Weight (lb)').fill('140');
    await button(page, 'Log set').click();
  }
  await button(page, 'Continue').click();
  await expect(page.getByRole('heading', { name: blockTitle })).toBeVisible();
}

const continueRotation = (page: Page) => button(page, 'Continue to Legs & core circuit →');

test('one Start, sixteen scheduled edges, one editable result, and Wait holds the review', async ({ page }, info) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await rotationEntry(page);
  const id = page.url().split('/').pop();
  await page.clock.setFixedTime(at(60_000));
  await expect(total(page)).toHaveText('12:00');
  await expect(phase(page)).toHaveCount(0);
  await capture(page, info.outputPath('coached-entry.png'));
  await button(page, 'Start block').click();
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'box-step-up');
  await page.evaluate(() => {
    const runner = document.querySelector('[data-testid="mixed-runner"]')!;
    runner.setAttribute('data-user-events', '0');
    runner.addEventListener('click', () => runner.setAttribute('data-user-events', String(Number(runner.getAttribute('data-user-events')) + 1)));
  });
  await page.clock.setFixedTime(at(68_000));
  await expect(phase(page)).toHaveText('00:37');
  await expect(total(page)).toHaveText('11:52');
  await capture(page, info.outputPath('2-1126-live.png'));
  const ids = ['box-step-up', 'seated-cable-row', 'goblet-squat', 'air-bike'];
  for (let edge = 1; edge <= 15; edge++) {
    await page.clock.setFixedTime(at(60_000 + edge * 45_000));
    await expect(current(page)).toHaveAttribute('data-exercise-id', ids[edge % 4]!);
    await expect(page.getByText(`Round ${Math.floor(edge / 4) + 1}`, { exact: true })).toBeVisible();
  }
  await page.clock.setFixedTime(at(780_000));
  await expect(page.getByText('4 full rotations completed')).toBeVisible();
  await expect(page.getByTestId('mixed-runner')).toHaveAttribute('data-user-events', '0');
  await expect(continueRotation(page)).toHaveCount(1);
  // The review counts down to the next block on its own; Wait keeps it here to edit.
  await expect(page.getByTestId('auto-countdown')).toContainText('Continuing to Legs & core circuit in 10 s');
  await button(page, 'Wait').click();
  await expect(page.getByTestId('auto-countdown')).toHaveCount(0);
  await capture(page, info.outputPath('coached-four-rotations.png'));
  await page.clock.setFixedTime(at(900_000));
  await expect(page.getByRole('heading', { name: blockTitle })).toBeFocused();
  await button(page, 'Edit what I did').click();
  await page.getByLabel('Completed rounds').fill('999');
  await expect(page.getByRole('alert')).toContainText('Completed rounds must be between 0 and 99');
  await page.getByLabel('Completed rounds').fill('-3');
  await expect(page.getByRole('alert')).toContainText('Completed rounds must be between 0 and 99');
  await page.getByLabel('Completed rounds').fill('3');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Partial station').selectOption('cable');
  await page.getByLabel('Partial work (reps)').fill('6');
  await capture(page, info.outputPath('coached-edit.png'));
  await button(page, 'Save edits').click();
  await expect(page.getByText('3 full rotations completed')).toBeVisible();
  await page.reload();
  await expect(page.getByText('3 full rotations completed')).toBeVisible();
  await button(page, 'Edit what I did').click();
  await expect(page.getByLabel('Partial station')).toHaveValue('cable');
  await expect(page.getByLabel('Partial work (reps)')).toHaveValue('6');
  await button(page, 'Save edits').click();
  await continueRotation(page).click();
  await expect(page.getByRole('heading', { name: 'Legs & core circuit' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('08:00');
  await finishTimed(page);
  await finishTimed(page, true);
  await expect(page).toHaveURL(new RegExp(`/workout/summary/${id}$`));
  const result = page.getByTestId('mixed-result-rotation');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('3 rotations');
  await expect(result).toContainText('Seated cable row · 6 reps');
  await page.getByRole('link', { name: 'View workout details' }).click();
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('3 rotations');
  await expect(result).toContainText('Seated cable row · 6 reps');
});

test('captures the zero-rotation review after Finish at eight seconds', async ({ page }, info) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await rotationEntry(page);
  await button(page, 'Start block').click();
  await expect(button(page, 'Finish block')).toBeEnabled();
  await page.clock.setFixedTime(at(8000));
  await expect(phase(page)).toHaveText('00:37');
  await button(page, 'Finish block').click();
  await expect(page.getByText('0 full rotations completed')).toBeVisible();
  await capture(page, info.outputPath('3-328-review.png'));
});

test('Next preserves total time and two clocks freeze and recover across reload', async ({ page }, info) => {
  await rotationEntry(page);
  await button(page, 'Start block').click();
  await expect(button(page, 'Next')).toBeEnabled();
  await page.clock.setFixedTime(at(8000));
  await expect(phase(page)).toHaveText('00:37');
  await button(page, 'Next').click();
  await expect(phase(page)).toHaveText('00:45');
  await expect(total(page)).toHaveText('11:52');
  await page.clock.setFixedTime(at(53_000));
  await page.reload();
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'goblet-squat');
  await button(page, 'Pause').click();
  await expect(button(page, 'Resume')).toBeVisible();
  await capture(page, info.outputPath('coached-paused.png'));
  await page.clock.setFixedTime(at(150_000));
  await page.reload();
  await expect(phase(page)).toHaveText('00:45');
  await expect(total(page)).toHaveText('11:07');
  await button(page, 'Resume').click();
  await expect(button(page, 'Pause')).toBeEnabled();
  await page.clock.setFixedTime(at(200_000));
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'air-bike');
  await button(page, 'Next').click();
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'box-step-up');
  await expect(page.getByText('Round 2', { exact: true })).toBeVisible();
  await expect(total(page)).toHaveText('10:17');
});

const timed = () => {
  const block = COACHED_TEMPLATE.ordered!.blocks[2]!;
  if (block.kind !== 'coached' || !block.stations) throw new Error('Missing coached fixture');
  const template: Template = { ...COACHED_TEMPLATE, blocks: [], ordered: { name: 'Timed rotation', blocks: [{ ...block, restSec: 3, transitionSec: 2 }] } };
  return template;
};

test('muted rotation keeps phase changes, preview choice and a silent overdue reload', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: class {
      constructor() { document.documentElement.setAttribute('data-audio-opened', 'true'); }
      resume() { return Promise.resolve(); }
    } });
  });
  await seed(page, timed(), { soundCues: false });
  await expect(page.getByText('Sound cues off')).toBeVisible();
  await button(page, 'Start block').click();
  await expect(page.getByTestId('pose-box-step-up')).toHaveAttribute('data-running', 'true');
  await button(page, 'Play Seated cable row').press('Enter');
  await expect(page.getByTestId('pose-seated-cable-row')).toHaveAttribute('data-running', 'true');
  await page.clock.setFixedTime(at(45_000));
  await expect(phase(page)).toHaveText('00:03');
  await expect(page.getByTestId('pose-seated-cable-row')).toHaveAttribute('data-running', 'true');
  await page.clock.setFixedTime(at(48_000));
  await expect(phase(page)).toHaveText('00:02');
  await page.clock.setFixedTime(at(50_000));
  await expect(current(page)).toHaveAttribute('data-exercise-id', 'seated-cable-row');
  await expect(page.locator('.gym-card [data-running="true"]')).toHaveCount(1);
  await expect(page.locator('[data-audio-opened]')).toHaveCount(0);
  await page.clock.setFixedTime(at(730_000));
  await page.reload();
  await expect(page.getByText('3 full rotations completed')).toBeVisible();
  await page.reload();
  await expect(button(page, 'Finish workout')).toHaveCount(1);
  await expect(page.locator('[data-audio-opened]')).toHaveCount(0);
});

test('unsupported audio and wake lock do not block review', async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of ['AudioContext', 'webkitAudioContext']) Object.defineProperty(window, key, { value: undefined });
    Object.defineProperty(navigator, 'wakeLock', { value: undefined });
  });
  await seed(page, timed());
  await button(page, 'Start block').click();
  await expect(button(page, 'Pause')).toBeEnabled();
  await page.clock.setFixedTime(at(720_000));
  await expect(page.getByText('3 full rotations completed')).toBeVisible();
  await button(page, 'Finish workout').click();
  await expect(page.getByTestId('mixed-result-rotation')).toContainText('3 rotations');
});

test('plays one fresh cue per foreground edge and only completion at the deadline', async ({ page }) => {
  await page.addInitScript(() => {
    const frequencies: number[] = [];
    Object.defineProperty(window, 'AudioContext', { value: class {
      state = 'running';
      currentTime = 0;
      resume() { return Promise.resolve(); }
      createOscillator() {
        const frequency = { value: 0, setValueAtTime() {} };
        return { frequency, connect: (gain: unknown) => gain, stop() {}, start() {
          frequencies.push(frequency.value);
          document.documentElement.setAttribute('data-cues', frequencies.join(','));
        } };
      }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    } });
  });
  const fixture = timed();
  const block = fixture.ordered!.blocks[0]!;
  if (block.kind !== 'coached') throw new Error('Missing coached block');
  block.durationSec = 100;
  await seed(page, fixture);
  await button(page, 'Start block').click();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-cues', '1320');
  for (const [before, edge, cueList] of [
    [44_500, 45_000, '1320,880'], [47_500, 48_000, '1320,880,880'],
    [49_500, 50_000, '1320,880,880,1320'],
  ] as const) {
    await page.clock.setFixedTime(at(before));
    await expect(phase(page)).toHaveText('00:01');
    await page.clock.setFixedTime(at(edge));
    await expect(html).toHaveAttribute('data-cues', cueList);
  }
  await page.clock.setFixedTime(at(99_500));
  await expect(total(page)).toHaveText('00:01');
  await page.clock.setFixedTime(at(100_000));
  await expect(button(page, 'Finish workout')).toBeVisible();
  await expect(html).toHaveAttribute('data-cues', '1320,880,880,1320,660');
  await page.reload();
  await expect(button(page, 'Finish workout')).toBeVisible();
  await expect(html).not.toHaveAttribute('data-cues');
});

test('verified demos and a replacement survive a service-worker-controlled offline reload', async ({ page, context }, info) => {
  await seed(page, timed());
  await page.setViewportSize({ width: 390, height: 844 });
  const demos = [['box-step-up', 'bodyweight'], ['seated-cable-row', 'cable-stack'], ['goblet-squat', 'dumbbells'], ['air-bike', 'air-bike']] as const;
  await expect(page.getByText('Sound cues on')).toBeVisible();
  for (const [id, equipment] of demos) {
    const card = page.locator(`[data-exercise-id="${id}"]`);
    await expect(card).toHaveAttribute('data-equipment-id', equipment);
    // The first card autoplays; pick any other card, which moves playback to it.
    if ((await page.getByTestId(`pose-${id}`).getAttribute('data-running')) !== 'true') await card.getByRole('button', { name: /^Play / }).press('Enter');
    await expect(page.getByTestId(`pose-${id}`)).toHaveAttribute('data-running', 'true');
    await expect(page.locator('.gym-card [data-running="true"]')).toHaveCount(1);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [id] of demos) {
    await expect(page.getByTestId(`pose-${id}`)).toHaveAttribute('data-static', 'true');
    await expect(page.getByTestId(`cues-${id}`)).toBeVisible();
  }
  await button(page, 'Start block').click();
  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(() => pageWidth(page)).toBe(320);
  expect(await tooSmall(page)).toEqual([]);
  await button(page, 'Finish block').scrollIntoViewIfNeeded();
  await expect(button(page, 'Finish block')).toBeInViewport();
  if (!(await page.evaluate(() => 'serviceWorker' in navigator))) {
    info.annotations.push({ type: 'evidence-gap', description: 'Service worker API unavailable in this WebKit session' });
    return;
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  for (const [id] of demos) await expect(page.getByTestId(`pose-${id}`)).toHaveAttribute('data-static', 'true');
  await button(page, 'Swap Goblet squat').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Seated cable row' })).toHaveCount(0);
  await button(page, 'Leg press').click();
  await expect(page.getByTestId('pose-leg-press')).toBeVisible();
  await expect(page.locator('[data-exercise-id="leg-press"]')).toContainText('45 sec work');
  await page.reload();
  for (const id of ['box-step-up', 'seated-cable-row', 'leg-press', 'air-bike']) {
    await expect(page.getByTestId(`pose-${id}`)).toHaveAttribute('data-static', 'true');
  }
});
