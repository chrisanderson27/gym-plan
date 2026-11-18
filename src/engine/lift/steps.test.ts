import { describe, expect, it } from 'vitest';
import { nearestStep, nextStep, stepBy } from './steps';

const pin = [10, 25, 40, 55, 70, 85, 100, 115, 130];
const kb = [10, 15, 18, 20, 25, 30, 35, 40, 44, 50, 53, 62];
const bar = [45, 50, 55, 60, 135, 140, 145, 150];

describe('steps', () => {
  it('nextStep walks the array', () => {
    expect(nextStep(pin, 100)).toBe(115);
    expect(nextStep(kb, 18)).toBe(20);
    expect(nextStep(kb, 44)).toBe(50);
    expect(nextStep(bar, 135, 10)).toBe(145);
    expect(nextStep(pin, 130)).toBeNull();
    expect(nextStep([], 5)).toBeNull();
  });
  it('nearestStep rounds, ties down', () => {
    expect(nearestStep(pin, 106.4)).toBe(100);
    expect(nearestStep(pin, 107.5)).toBe(100);
    expect(nearestStep([], 7)).toBe(7);
  });
  it('stepBy clamps', () => {
    expect(stepBy(pin, 100, 2)).toBe(130);
    expect(stepBy(pin, 100, 5)).toBe(130);
    expect(stepBy(pin, 10, -1)).toBe(10);
    expect(stepBy([], 12, 1)).toBe(12);
  });
});
