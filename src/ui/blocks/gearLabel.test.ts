import { expect, it } from 'vitest';
import { exerciseById } from '../../content';
import { stationGearLabel } from './gearLabel';

it('labels leg press, step-up and goblet squat from the checklist', () => {
  expect(stationGearLabel(exerciseById.get('leg-press')!)).toBe('45° leg press');
  expect(stationGearLabel(exerciseById.get('step-up')!)).toBe('Plyo box');
  expect(stationGearLabel(exerciseById.get('goblet-squat')!)).toBe('Dumbbells');
});
