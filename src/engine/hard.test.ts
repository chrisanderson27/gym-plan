import { describe, expect, it } from 'vitest';
import { classifyHard } from './hard';

describe('classifyHard', () => {
  it.each([
    ['burn', { type: 'burn', rpe: null, runKinds: [] }, { hard: true, hardCardio: true }],
    ['intervals run', { type: 'run', rpe: 6, runKinds: ['intervals'] }, { hard: true, hardCardio: true }],
    ['easy run rpe 8', { type: 'run', rpe: 8, runKinds: ['easy'] }, { hard: true, hardCardio: false }],
    ['lift rpe null', { type: 'lift', rpe: null, runKinds: [] }, { hard: false, hardCardio: false }],
    ['lift rpe 9', { type: 'lift', rpe: 9, runKinds: [] }, { hard: true, hardCardio: false }],
    ['hybrid easy run rpe 6', { type: 'hybrid', rpe: 6, runKinds: ['easy'] }, { hard: false, hardCardio: false }],
    ['hybrid intervals (bike)', { type: 'hybrid', rpe: null, runKinds: ['intervals'] }, { hard: true, hardCardio: true }],
    ['swim rpe 8', { type: 'swim', rpe: 8, runKinds: [] }, { hard: true, hardCardio: false }],
  ] as const)('%s', (_n, input, expected) => {
    expect(classifyHard({ ...input, runKinds: [...input.runKinds] })).toEqual(expected);
  });
});
