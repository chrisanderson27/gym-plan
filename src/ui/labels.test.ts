import { describe, expect, it } from 'vitest';
import { EXERCISES, LIFT_TEMPLATES, SEED_EQUIPMENT } from '../content';
import { FEEDBACK_TAGS } from '../data/types';
import { HYBRID_LEG_MODALITIES, TRACKED_MUSCLES } from '../engine/config';
import {
  EQUIPMENT_TAG_LABELS, MODALITY_LABELS, MUSCLE_LABELS, RUN_KIND_LABELS,
  durationLabel, equipmentTagName, humanize, modalityName, muscleName, plural, runKindName, screenName, sessionTypeLabel, tagLabel, exerciseName, variantName,
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
