import { expect, it } from 'vitest';
import { exerciseById } from '../../content';
import { stationGearLabel } from './gearLabel';

it('labels leg press, step-up and goblet squat from the checklist', () => {
  expect(stationGearLabel(exerciseById.get('leg-press')!)).toBe('45° leg press');
  expect(stationGearLabel(exerciseById.get('step-up')!)).toBe('Plyo box');
  expect(stationGearLabel(exerciseById.get('goblet-squat')!)).toBe('Dumbbells');
});

it('names machines instead of calling them bodyweight', () => {
  expect(stationGearLabel(exerciseById.get('leg-extension')!)).toBe('Pin-stack machine');
  expect(stationGearLabel(exerciseById.get('chest-press-machine')!)).toBe('Pin-stack machine');
  expect(stationGearLabel(exerciseById.get('hack-squat')!)).toBe('Plate-loaded machine');
  expect(stationGearLabel(exerciseById.get('push-up')!)).toBe('Bodyweight');
});
