import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { ExportFile } from '../src/data/migrations';
import type { Session, Template } from '../src/data/types';
import { onboard, pageWidth, seedBackup, tooSmall } from './helpers';

const at = new Date('2026-11-22T12:00:00-05:00');
const saved = (page: Page) => page.getByRole('region', { name: 'Saved workouts' });
const suggestions = (page: Page) => page.getByRole('region', { name: 'Suggested workouts' });
const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
const openWorkouts = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Workouts' }).click();

async function download(page: Page, info: TestInfo, name: string) {
  await page.goto('./#/settings');
  const [file] = await Promise.all([page.waitForEvent('download'), button(page, 'Download backup').click()]);
  const path = info.outputPath(name + '.json');
  await file.saveAs(path);
  return { path, export: JSON.parse(await readFile(path, 'utf8')) as ExportFile };
}

async function controlledOffline(page: Page, context: BrowserContext, info: TestInfo) {
  if (!(await page.evaluate(() => 'serviceWorker' in navigator))) {
    info.annotations.push({ type: 'evidence-gap', description: 'Service worker API unavailable in this WebKit process' });
    return false;
  }
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 20_000 }).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(async () => {
    await document.fonts.load('800 24px Manrope');
    await document.fonts.load('700 11px "IBM Plex Mono"');
    return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll('"', ''));
  })).toEqual(expect.arrayContaining(['Manrope', 'IBM Plex Mono']));
  const caches = await page.evaluate(async () => (await Promise.all((await window.caches.keys())
    .map(async (key) => (await (await window.caches.open(key)).keys()).map((request) => request.url)))).flat());
  expect(caches.filter((url) => url.includes('.woff2')).length).toBeGreaterThanOrEqual(2);
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => fetch('./not-precached-' + Date.now(), { cache: 'no-store' }).then(() => 'online', () => 'offline'))).toBe('offline');
  return true;
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: info.outputPath(name + '.png'), scale: 'css' });
}

async function contrast(control: Locator, pseudo?: string) {
  return control.evaluate((el, text) => {
    const luminance = (rgb: string) => rgb.match(/[\d.]+/g)!.slice(0, 3)
      .map((value) => Number(value) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
    const fg = luminance(getComputedStyle(el, text).color);
    const bg = luminance(getComputedStyle(el).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  }, pseudo);
}

function readSession(page: Page, id: string): Promise<Session> {
  return page.evaluate((sessionId) => new Promise<Session>((resolve, reject) => {
    const connection = indexedDB.open('gym-plan');
    connection.onerror = () => reject(connection.error);
    connection.onsuccess = () => {
      const db = connection.result;
      const read = db.transaction('sessions').objectStore('sessions').get(sessionId);
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }), id);
}

test('reference Workouts layouts, suggestion saves, focus and 56 px actions', async ({ page }, info) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.clock.setFixedTime(at);
  await onboard(page);
  await seedBackup(page, { settings: [{
    id: 'settings', weightUnit: 'lb', distanceUnit: 'mi', goalWeightLb: 220, daysPerWeek: 5,
    programStart: '2026-07-05', onboardedAt: '2026-07-05T12:00:00Z', updatedAt: new Date(+at + 1000).toISOString(), backupAt: null,
  }] }, 2);
  await openWorkouts(page);
  await expect(page.getByRole('link', { name: 'Workouts' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Week 21')).toBeVisible();
  await capture(page, info, 'workouts-empty');
  for (const [index, title] of ['Upper Push & Pull', 'Full-Body Strength'].entries()) {
    await page.clock.setFixedTime(new Date(+at + index * 1000));
    await button(suggestions(page).getByRole('article', { name: title }), 'Preview').click();
    await button(page.getByRole('dialog', { name: 'Preview ' + title }), 'Save a copy').click();
    await button(page.getByRole('dialog', { name: 'Preview ' + title }), 'Close preview').click();
    await expect(saved(page).getByRole('article', { name: title })).toBeVisible();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, info, '3-2286-top');
  expect((await page.getByRole('navigation', { name: 'Main' }).boundingBox())!.y).toBeGreaterThanOrEqual(810);
  expect((await saved(page).getByRole('article').first().boundingBox())!.x).toBe(16);
  const suggestedHeading = suggestions(page).getByRole('heading', { level: 2 });
  await suggestedHeading.evaluate(async (el) => {
    await document.fonts.ready;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  await expect(suggestedHeading).toBeInViewport({ ratio: 0.9 });
  await expect(page.locator('.workouts > .pref-top')).not.toBeInViewport();
  await page.screenshot({ path: info.outputPath('3-2286-suggested-scroll.png'), scale: 'css' });

  const opener = button(page, 'New workout');
  expect(await contrast(opener)).toBeGreaterThanOrEqual(4.5);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Build a workout' });
  await expect(dialog).toBeFocused();
  expect(await contrast(dialog.getByRole('textbox', { name: 'Workout name' }), '::placeholder')).toBeGreaterThanOrEqual(4.5);
  expect((await dialog.boundingBox())!.y).toBe(0);
  await page.keyboard.press('Tab');
  await expect(button(dialog, 'Close workout builder')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(button(dialog, 'More strength blocks')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(button(dialog, 'Close workout builder')).toBeFocused();
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0);
  for (const title of ['Legs & core circuit', 'Four-station rotation', 'Cool-down']) await button(dialog, 'Add ' + title).click();
  await expect(button(dialog, 'Legs & core circuit, block 1, actions')).toBeVisible();
  await expect(button(dialog, 'Four-station rotation, block 2, actions')).toBeVisible();
  await expect(button(dialog, 'Cool-down, block 3, actions')).toBeVisible();
  await expect(button(dialog, 'Save workout')).toBeDisabled();
  await dialog.getByRole('list', { name: 'Workout blocks' }).evaluate((el) => { el.scrollTop = 0; });
  await capture(page, info, '3-2652-partial-disabled');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 550 });
    expect(await pageWidth(page)).toBe(width);
    expect(await tooSmall(page)).toEqual([]);
    await opener.click();
    await dialog.getByRole('textbox', { name: 'Workout name' }).fill('Friday Strength with a Long Workout Title '.repeat(5));
    await button(dialog, 'Add Warm-up').click();
    await button(dialog, 'Save workout').scrollIntoViewIfNeeded();
    await expect(button(dialog, 'Save workout')).toBeInViewport();
    expect(await tooSmall(page)).toEqual([]);
    await capture(page, info, `workout-narrow-${width}`);
    await button(dialog, 'Close workout builder').click();
  }

  const legs = suggestions(page).getByRole('article', { name: 'Lower Strength & Core' });
  await button(legs, 'Preview').click();
  const preview = page.getByRole('dialog', { name: 'Preview Lower Strength & Core' });
  await expect(preview.locator('.workout-preview-list > li > h3')).toHaveCount(6);
  await expect(preview.locator('[data-running="true"]')).toHaveCount(1);
  await button(preview, 'Start workout').click();
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
});

async function saveBlock(page: Page, name: string, kind: 'self-paced' | 'coached', pickerLabel: string, minutes: string) {
  await page.goto('./#/blocks/new');
  await page.getByLabel('Block name').fill(name);
  await page.getByLabel('Block type').selectOption(kind);
  await button(page, 'Add exercise').click();
  await button(page.getByRole('dialog', { name: 'Add an exercise' }), pickerLabel).click();
  // One station saves only while it stays within six rounds.
  await page.getByLabel('Minutes').fill(minutes);
  await expect(page.getByRole('checkbox', { name: 'Include in my plan' })).not.toBeChecked();
  await button(page, 'Save to My Blocks').click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

test('author, edit, run, restore and repeat all five kinds after source deletion', async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(at);
  await onboard(page);
  await saveBlock(page, 'Personal circuit', 'self-paced', 'Reverse lunge Dumbbells', '3');
  await saveBlock(page, 'Personal rotation', 'coached', 'Seated cable row Seated cable row', '4');
  await openWorkouts(page);
  await button(page, 'New workout').click();
  const draft = page.getByRole('dialog', { name: 'Build a workout' });
  await expect(button(draft, 'Save workout')).toBeDisabled();
  for (const title of ['Warm-up', 'Personal circuit', 'Leg press', 'Personal rotation', 'Four-station rotation', 'Legs & core circuit']) await button(draft, 'Add ' + title).click();
  // The calf raise keeps the short personal blocks over the 45-minute floor.
  await button(draft, 'More strength blocks').click();
  for (const title of ['Standing or seated calf raise', 'Cool-down']) await button(draft, 'Add ' + title).click();
  await button(draft, 'Personal circuit, block 2, actions').click();
  await button(draft, 'Move down').click();
  await button(draft, 'Move down').click();
  await button(draft, 'Cool-down, block 8, actions').click();
  await button(draft, 'Remove').click();
  await button(draft, 'Add Cool-down').click();
  await draft.getByRole('textbox', { name: 'Workout name' }).fill('  Friday mixed  ');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'templates') {
        IDBObjectStore.prototype.add = original;
        this.transaction.abort();
      }
      return request;
    };
  });
  await button(draft, 'Save workout').click();
  await expect(draft.getByRole('alert')).toHaveText('Could not save the workout. Try again.');
  await expect(draft.getByRole('textbox', { name: 'Workout name' })).toHaveValue('  Friday mixed  ');
  await capture(page, info, 'workout-save-retry');
  await button(draft, 'Save workout').click();
  const card = saved(page).getByRole('article', { name: 'Friday mixed' });
  await expect(card).toBeVisible();
  await page.reload();
  await button(card, 'Preview').click();
  const preview = page.getByRole('dialog', { name: 'Preview Friday mixed' });
  const order = ['Warm-up', 'Leg press', 'Personal rotation', 'Personal circuit', 'Four-station rotation', 'Legs & core circuit', 'Standing or seated calf raise', 'Cool-down'];
  await expect(preview.locator('.workout-preview-list > li > h3')).toHaveText(order);
  await button(preview, 'Edit workout').click();
  const edit = page.getByRole('dialog', { name: 'Edit workout' });
  await edit.getByRole('textbox', { name: 'Workout name' }).fill('Friday mixed edited');
  await capture(page, info, 'workout-edit');
  await button(edit, 'Save workout').click();
  // A saved Extend or edit reopens the preview on the saved prescription.
  await button(page.getByRole('dialog', { name: 'Preview Friday mixed edited' }), 'Close preview').click();

  await page.getByRole('link', { name: 'Blocks' }).click();
  await page.getByRole('link', { name: 'Personal rotation', exact: true }).click();
  await page.getByLabel('Minutes').fill('3');
  await page.getByRole('checkbox', { name: 'Include in my plan' }).check();
  await button(page, 'Save to My Blocks').click();
  await expect(page.getByText('1 exercise × about 5 rounds · 3 min · Coached rotation', { exact: true })).toBeVisible();
  await button(page, 'Remove Personal circuit').click();
  await page.getByTestId('block-remove-confirm').click();
  await expect(page.getByRole('link', { name: 'Personal circuit', exact: true })).toHaveCount(0);
  await openWorkouts(page);
  const editedCard = saved(page).getByRole('article', { name: 'Friday mixed edited' });
  const editedPreview = page.getByRole('dialog', { name: 'Preview Friday mixed edited' });
  await button(editedCard, 'Preview').click();
  await expect(editedPreview.locator('.workout-preview-list > li > h3')).toHaveText(order);
  await expect(editedPreview.getByText('Coached rotation · 4 min', { exact: true })).toBeVisible();
  await capture(page, info, 'workout-preview');
  await button(editedPreview, 'Start workout').evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
  await expect(page.getByRole('heading', { name: 'Preparation' })).toBeVisible();
  const sid = page.url().split('/').at(-1)!;
  await page.goto('./#/');
  const hero = page.getByTestId('hero');
  await expect(hero.getByRole('heading', { name: 'Friday mixed edited', exact: true })).toBeVisible();
  const resume = hero.getByRole('link', { name: 'Resume', exact: true });
  await expect(resume).toHaveAttribute('href', `#/workout/session/${sid}`);
  await resume.click();
  await expect(page).toHaveURL(new RegExp('/workout/session/' + sid + '$'));
  const finishTimed = async (next: string) => {
    await button(page, 'Start block').click();
    await button(page, 'Finish block').click();
    await button(page, next).click();
  };
  await finishTimed('Continue');
  await expect(page.getByRole('heading', { name: 'Leg press' })).toBeVisible();
  await page.getByLabel('Weight (lb)').fill('95');
  await page.getByLabel('Reps').fill('99999');
  await button(page, 'Log set').click();
  await expect(page.getByRole('alert')).toContainText('Reps must be between 1 and 999');
  await page.getByLabel('Reps').fill('10');
  await button(page, 'Log set').click();
  await button(page, 'Finish block').click();
  await button(page, 'Continue').click();
  await expect(page.getByRole('heading', { name: 'Personal rotation' })).toBeVisible();
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  await page.getByRole('button', { name: /^Continue to Personal circuit/ }).click();
  await expect(page.getByRole('heading', { name: 'Personal circuit' })).toBeVisible();
  await button(page, 'Start block').click();
  await button(page, 'Swap Reverse lunge').click();
  await button(page.getByRole('dialog'), 'Step-up to box').click();
  const swapped = page.getByTestId('pose-step-up');
  await expect(swapped).toBeVisible();
  const beforePlayback = await readSession(page, sid);
  const clockBefore = await page.getByRole('timer').textContent();
  // The swapped card autoplays, and playback never touches the clock or the log.
  await expect(swapped).toHaveAttribute('data-running', 'true');
  const frame = await swapped.innerHTML();
  await expect.poll(() => swapped.innerHTML()).not.toBe(frame);
  await expect(page.locator('.gym-card [data-running="true"]')).toHaveCount(1);
  await expect(page.getByRole('timer')).toHaveText(clockBefore!);
  await capture(page, info, 'workout-active-swapped');
  await button(page, 'Pause Step-up to box').press('Enter');
  expect(await readSession(page, sid)).toEqual(beforePlayback);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(swapped).toHaveAttribute('data-static', 'true');
  await expect(page.getByTestId('cues-step-up')).toBeVisible();
  await capture(page, info, 'workout-reduced-motion');
  await button(page, 'Finish block').click();
  await button(page, 'Continue').click();
  await expect(page.getByRole('heading', { name: 'Four-station rotation' })).toBeVisible();
  await button(page, 'Start block').click();
  await button(page, 'Finish block').click();
  await page.getByRole('button', { name: /^Continue to Legs & core circuit/ }).click();
  await finishTimed('Continue');
  await expect(page.getByRole('heading', { name: 'Standing or seated calf raise' })).toBeVisible();
  await button(page, 'Skip block').click();
  await button(page, 'Continue').click();
  await expect(page.getByRole('heading', { name: 'Recovery' })).toBeVisible();
  await finishTimed('Finish workout');
  await expect(page).toHaveURL(new RegExp('/workout/summary/' + sid + '$'));
  const effort = button(page.getByTestId('mixed-summary'), 'Hard');
  await effort.click();
  await expect(effort).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'View workout details' }).click();
  await expect(page).toHaveURL(new RegExp('/history/' + sid + '$'));
  await expect(page.getByRole('heading', { name: 'Personal circuit', exact: true })).toBeVisible();

  const original = await download(page, info, 'authored');
  const authored = original.export.stores.templates![0] as Template;
  const finished = (original.export.stores.sessions as Session[]).find((session) => session.id === sid)!;
  expect(finished.mixed?.prescription).toEqual(authored.ordered);
  expect(finished.rpe).toBe(9);
  expect(finished.mixed?.results[authored.ordered!.blocks[3]!.id]).toMatchObject({ rounds: null, stations: [{ exerciseId: 'step-up' }] });
  expect(original.export.stores.sets).toHaveLength(1);
  expect(original.export.stores.libraryBlocks).toMatchObject([{ durationSec: 180, recommend: true }]);

  const context = await browser.newContext(info.project.use);
  try {
    const fresh = await context.newPage();
    await fresh.goto('./');
    // A frozen clock can stall the precache install, so let the worker activate first.
    await expect.poll(() => fresh.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 20_000 }).toBe(true);
    // The seeded default row has an epoch updatedAt, so the incoming settings win.
    await fresh.clock.setFixedTime(new Date(+at - 1000));
    await onboard(fresh);
    await fresh.goto('./#/settings');
    await fresh.locator('input[type=file]').setInputFiles(original.path);
    await expect(fresh.getByTestId('backup-message')).toContainText('Imported');
    const restored = await download(fresh, info, 'restored');
    for (const key of ['templates', 'sessions', 'sets', 'libraryBlocks']) expect(restored.export.stores[key]).toEqual(original.export.stores[key]);

    await fresh.goto('./#/workouts');
    await controlledOffline(fresh, context, info);
    await expect(fresh.getByText('Gym Plan.')).toBeVisible();
    await button(saved(fresh).getByRole('article', { name: authored.name }), 'Preview').click();
    await button(fresh.getByRole('dialog'), 'Edit workout').click();
    await fresh.getByRole('textbox', { name: 'Workout name' }).fill('Restored circuit day');
    await button(fresh.getByRole('dialog'), 'Save workout').click();
    await button(fresh.getByRole('dialog', { name: 'Preview Restored circuit day' }), 'Close preview').click();
    await button(saved(fresh).getByRole('article', { name: 'Restored circuit day' }), 'Start workout').click();
    await expect(fresh.getByRole('heading', { name: 'Preparation' })).toBeVisible();

    // Remove the template through IndexedDB to cover the same case as an absent saved source on a restored profile.
    await fresh.evaluate((id) => new Promise<void>((resolve, reject) => {
      const connection = indexedDB.open('gym-plan');
      connection.onerror = () => reject(connection.error);
      connection.onsuccess = () => {
        const db = connection.result;
        const tx = db.transaction('templates', 'readwrite');
        tx.objectStore('templates').delete(id);
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    }), authored.id);
    await fresh.goto('./#/history/' + sid);
    await fresh.getByTestId('again').click();
    await expect(fresh.getByRole('heading', { name: authored.name })).toBeVisible();
    await fresh.getByTestId('again-start').click();
    await expect(fresh.getByRole('heading', { name: 'Preparation' })).toBeVisible();
    const repeatedId = fresh.url().split('/').at(-1)!;
    expect(repeatedId).not.toBe(sid);
    const replay = (await download(fresh, info, 'repeated')).export;
    const repeated = (replay.stores.sessions as Session[]).find((session) => session.id === repeatedId)!;
    expect(repeated.rpe).toBeNull();
    expect(repeated.mixed).toMatchObject({
      prescription: authored.ordered, cursor: { stage: 'entry', setSlot: 0 }, results: {}, timers: {},
      stations: { [authored.ordered!.blocks[3]!.id]: [{ exerciseId: 'reverse-lunge' }] },
      drafts: { [authored.ordered!.blocks[3]!.id]: { rounds: null, tapped: 0 } },
    });
    expect(replay.stores.sets).toEqual(original.export.stores.sets);
  } finally {
    await context.close();
  }
});

test('v1 lift edit and legacy cardio keep their direct and offline library routes', async ({ page, context }, info) => {
  await onboard(page);
  const templates: Template[] = [{
    id: 'legacy-lift', name: 'Old paired lifts', source: 'built', type: 'custom', createdAt: at.toISOString(),
    blocks: ['chest-press-machine', 'seated-cable-row'].map((exerciseId) => ({
      id: exerciseId, kind: 'lift', exerciseId, sets: 3, repMin: 8, repMax: 12, supersetGroup: 'pair',
    })),
  }, {
    id: 'legacy-run', name: 'Old easy run', source: 'saved', type: 'run', createdAt: at.toISOString(),
    blocks: [{ id: 'run', kind: 'run', runKind: 'easy', modality: 'run', repeats: 1, segments: [{ role: 'run', sec: 1200 }] }],
  }];
  await seedBackup(page, { templates });
  await openWorkouts(page);
  await expect(saved(page).getByRole('article')).toHaveCount(2);
  // The legacy builder route is gone: it redirects to the saved workout's Repeat screen.
  await page.goto('./#/builder/legacy-lift');
  await expect(page).toHaveURL(/#\/mine\/legacy-lift$/);
  await expect(page.getByTestId('legacy-again')).toBeVisible();
  await page.goto('./#/workouts');
  await controlledOffline(page, context, info);
  await button(suggestions(page).getByRole('article', { name: 'Full-Body Strength' }), 'Preview').click();
  const starter = page.getByRole('dialog', { name: 'Preview Full-Body Strength' });
  await expect(starter.getByTestId('pose-hip-thrust')).toBeVisible();
  await button(starter, 'Close preview').click();
  const run = saved(page).getByRole('article', { name: 'Old easy run' });
  await run.getByRole('link', { name: 'Preview' }).click();
  await expect(page).toHaveURL(/#\/mine\/legacy-run$/);
  await expect(page.getByTestId('legacy-again')).toBeVisible();
  await page.goto('./#/mine/legacy-lift');
  await expect(page.getByTestId('legacy-again')).toBeVisible();
  await expect(page.getByTestId('legacy-build')).toBeVisible();
});

test('refreshes stale previews and offers repair or Skip for unsupported prescriptions', async ({ page, context }, info) => {
  await onboard(page);
  const templates: Template[] = [{
    id: 'stale', name: 'Original warm-up', source: 'saved', type: 'custom', createdAt: at.toISOString(), blocks: [],
    ordered: { name: 'Original warm-up', blocks: [{ id: 'prep', kind: 'preparation', durationSec: 2700, instructions: 'Warm up.' }] },
  }, {
    id: 'old-rotation', name: 'Old rotation', source: 'saved', type: 'custom', createdAt: at.toISOString(), blocks: [],
    ordered: { name: 'Old rotation', blocks: [{ id: 'old', kind: 'coached', name: 'Schedule pending', durationSec: 120 }] },
  }];
  await seedBackup(page, { templates }, 2);
  await openWorkouts(page);
  await button(saved(page).getByRole('article', { name: 'Original warm-up' }), 'Preview').click();
  const other = await context.newPage();
  try {
    await seedBackup(other, { templates: [{ ...templates[0], name: 'Changed warm-up',
      ordered: { name: 'Changed warm-up', blocks: [{ id: 'prep', kind: 'preparation', durationSec: 2700,
        instructions: 'Historic movement.', exerciseId: 'unknown-movement' }] },
    }] }, 2);
  } finally {
    await other.close();
  }
  await button(page.getByRole('dialog', { name: 'Preview Original warm-up' }), 'Start workout').click();
  const updated = page.getByRole('dialog', { name: 'Preview Changed warm-up' });
  await expect(updated.getByRole('alert')).toContainText('Review the current plan');
  await expect(updated.getByText(/Demo unavailable/)).toBeVisible();
  await expect(updated.getByRole('button', { name: /^Play/ })).toHaveCount(0);
  await capture(page, info, 'workout-unavailable-preview');
  await button(updated, 'Start workout').click();
  await expect(button(page, 'Start block')).toBeDisabled();
  await button(page, 'Skip block').click();
  await button(page, 'Finish workout').click();

  await expect(page).toHaveURL(/#\/workout\/summary\/[^/]+$/);
  await expect(page.getByTestId('mixed-summary')).toContainText('Changed warm-up · 0 blocks finished · 0 sets logged · 1 skipped');
  await openWorkouts(page);
  await expect(page).toHaveURL(/#\/workouts$/);
  await button(saved(page).getByRole('article', { name: 'Old rotation' }), 'Preview').click();
  await button(page.getByRole('dialog'), 'Edit workout').click();
  const editor = page.getByRole('dialog', { name: 'Edit workout' });
  await expect(editor.getByText(/Missing station schedule/)).toBeVisible();
  await expect(button(editor, 'Save workout')).toBeDisabled();
  await capture(page, info, 'workout-missing-schedule');
  await button(editor, 'Schedule pending, block 1, actions').click();
  await button(editor, 'Remove').click();
  for (const title of ['Four-station rotation', 'Legs & core circuit', 'Easy run · 20 min', 'Warm-up', 'Cool-down']) await button(editor, 'Add ' + title).click();
  await expect(button(editor, 'Save workout')).toBeEnabled();
  await button(editor, 'Save workout').click();
  await button(page.getByRole('dialog', { name: 'Preview Old rotation' }), 'Close preview').click();
  await expect(editor).toHaveCount(0);
  await expect(button(saved(page).getByRole('article', { name: 'Old rotation' }), 'Start workout')).toBeEnabled();
  await page.goto('./#/builder/old-rotation');
  await expect(page).toHaveURL(/#\/mine\/old-rotation$/);
});
