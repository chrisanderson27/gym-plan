import { describe, expect, it } from 'vitest';
import { EXERCISES, HOME_GYM, LIFT_TEMPLATES, SEED_EQUIPMENT } from '../content';
import { FEEDBACK_TAGS } from '../data/types';
import { HYBRID_LEG_MODALITIES, TRACKED_MUSCLES } from '../engine/config';
import {
  EQUIPMENT_TAG_LABELS, MODALITY_LABELS, MUSCLE_LABELS, RUN_KIND_LABELS,
  durationLabel, equipmentTagName, humanize, modalityName, muscleName, plural, runKindName, screenName, sessionTypeLabel, tagLabel, exerciseName, variantName,
  floorLabel, prLabel, stationEquipmentLabel, zoneLabel,
} from './labels';

/** A label is "raw" when it is the id itself or still starts lower-case (a slug), e.g. "side-delts", "db". */
const isRaw = (label: string, id: string) => label === id || /^[a-z]/.test(label);

describe('every id used in content has a display label', () => {
  it('muscles', () => {
    const ids = new Set<string>([...TRACKED_MUSCLES, ...EXERCISES.flatMap((e) => [...e.primary, ...e.secondary])]);
    for (const id of ids) {
      expect(MUSCLE_LABELS, id).toHaveProperty(id);
      expect(isRaw(muscleName(id), id), `${id} -> ${muscleName(id)}`).toBe(false);
    }
  });
  it('equipment tags', () => {
    for (const id of new Set(EXERCISES.flatMap((e) => e.equipment))) {
      expect(EQUIPMENT_TAG_LABELS, id).toHaveProperty(id);
      expect(isRaw(equipmentTagName(id), id), `${id} -> ${equipmentTagName(id)}`).toBe(false);
    }
  });
  it('modalities, run kinds, variants, feedback tags', () => {
    for (const id of new Set([...HYBRID_LEG_MODALITIES, 'run', 'treadmill'])) expect(MODALITY_LABELS, id).toHaveProperty(id);
    expect(modalityName('row')).toBe('Rower');
    expect(modalityName('ski')).toBe('Ski erg');
    for (const id of Object.keys(RUN_KIND_LABELS)) expect(runKindName(id)).not.toBe(id);
    for (const v of Object.keys(LIFT_TEMPLATES)) expect(variantName(v)).not.toBe(v);
    for (const t of FEEDBACK_TAGS) expect(tagLabel(t)).not.toMatch(/-/);
  });
  it('seed equipment has a readable name', () => {
    for (const e of SEED_EQUIPMENT) expect(e.name, e.id).not.toMatch(/^[0-9A-Z]{26}$/);
  });
  it('formats durations and screens without ids', () => {
    expect(durationLabel(1800)).toBe('30 min');
    expect(durationLabel(30)).toBe('30 s');
    expect(durationLabel(90)).toBe('1 min 30 s');
    expect(screenName('#/lift/session/01M7ABCDEF')).toBe('Lift session');
    expect(screenName('#/settings')).toBe('Settings');
    expect(screenName(undefined)).toBeUndefined();
  });
});

describe('display labels', () => {
  it('names Progress detail screens', () => {
    expect(screenName('#/progress/history')).toBe('History');
    expect(screenName('#/progress/body')).toBe('Weigh-in');
    expect(screenName('#/progress/volume')).toBe('Weekly volume');
  });
  it('formats set and circuit PRs', () => {
    const set = { exerciseId: 'goblet-squat', equipmentId: 'bells', weight: 45, reps: 8, prev: 6 };
    expect(prLabel({ kind: 'weight-at-reps', ...set })).toBe(`${exerciseName(set.exerciseId)} 45 × 8`);
    expect(prLabel({ kind: 'reps-at-weight', ...set })).toBe(`${exerciseName(set.exerciseId)} 45 × 8`);
    expect(prLabel({ kind: 'block-work', blockId: 'b', total: 12.34, prev: 11 })).toBe('Block · 12.3 rounds');
  });
  it('maps variant ids inside free text and leaves the rest alone', () => {
    expect(humanize('After lower-a: upper-b')).toBe('After Lower A: Upper B');
    expect(humanize('upper-a muscles still recovering — lower-b instead')).toBe('Upper A muscles still recovering — Lower B instead');
    expect(humanize('No history yet — calibrate first')).toBe('No history yet — calibrate first');
  });
  it('title-cases feedback tags and session types', () => {
    expect(tagLabel('too-easy')).toBe('Too easy');
    expect(tagLabel('adjacent-machines')).toBe('Adjacent machines');
    expect(sessionTypeLabel('hybrid')).toBe('Hybrid');
  });
  it('pluralises', () => {
    expect(plural(1, 'set')).toBe('1 set');
    expect(plural(3, 'set')).toBe('3 sets');
  });
  it('falls back to the id for an unknown exercise', () => {
    expect(exerciseName('no-such-exercise')).toBe('no-such-exercise');
  });
});

it('formats lift-day floors and block zones', () => {
  expect([2, 1, 3].map(floorLabel)).toEqual(['upstairs', 'downstairs', 'Floor 3']);
  const turf = HOME_GYM.zones.find((zone) => zone.label === 'turf');
  const unlabelled = HOME_GYM.zones.find((zone) => zone.label === undefined);
  expect(turf).toBeDefined();
  expect(unlabelled).toBeDefined();
  expect(zoneLabel(turf!.id)).toBe('turf');
  expect(zoneLabel(unlabelled!.id)).toBe(floorLabel(unlabelled!.floor));
  expect(zoneLabel('zone-0000000000000000')).toBeUndefined();
});

it('omits the generic treadmill label on rower and ski stations', () => {
  const equipment = new Map(SEED_EQUIPMENT.map((row) => [row.id, row]));
  for (const exerciseId of ['rower', 'ski-erg']) {
    expect(stationEquipmentLabel({ equipmentId: 'treadmill', exerciseId }, equipment)).toBeUndefined();
  }
  expect(stationEquipmentLabel({ equipmentId: 'treadmill', exerciseId: 'treadmill' }, equipment)).toBe('Treadmill');
  expect(stationEquipmentLabel({ equipmentId: 'rower', exerciseId: 'rower' }, equipment)).toBe('Rower');
  expect(stationEquipmentLabel({ equipmentId: 'dumbbells', exerciseId: 'db-bench' }, equipment)).toBe('Dumbbells');
});
