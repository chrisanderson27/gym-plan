import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { blockedExerciseIds, EQUIPMENT_PREFS } from './equipment-prefs';

const blocked = (ids: string[]) => blockedExerciseIds(EXERCISES, ids);

describe('blockedExerciseIds', () => {
  it('lists twelve checklist rows in frame order', () => {
    expect(EQUIPMENT_PREFS.map((row) => row.id)).toEqual([
      'exercise-mat', 'dumbbells', 'leg-press', 'plyo-box', 'seated-cable-row', 'air-bike',
      'rower', 'resistance-band', 'flat-bench', 'kettlebell', 'treadmill', 'lap-pool',
    ]);
  });

  it('blocks reverse-lunge when dumbbells are off and leaves goblet-squat', () => {
    const ids = blocked(['dumbbells']);
    expect(ids.has('reverse-lunge')).toBe(true);
    expect(ids.has('goblet-squat')).toBe(false);
  });

  it('blocks goblet-squat only when both dumbbells and kettlebell are off', () => {
    expect(blocked(['kettlebell']).has('goblet-squat')).toBe(false);
    expect(blocked(['dumbbells', 'kettlebell']).has('goblet-squat')).toBe(true);
  });

  it('leaves the rower allowed when the air bike is off', () => {
    const ids = blocked(['air-bike']);
    expect(ids.has('air-bike')).toBe(true);
    expect(ids.has('rower')).toBe(false);
    expect(ids.has('treadmill')).toBe(false);
  });

  it('blocks the leg-press exercise only', () => {
    expect([...blocked(['leg-press'])].sort()).toEqual(['leg-press']);
  });

  it('stores an exercise mat without blocking anyone', () => {
    expect(blocked(['exercise-mat']).size).toBe(0);
  });

  it('blocks swim when the lap pool is off', () => {
    expect(blocked(['lap-pool']).has('swim')).toBe(true);
  });
});
