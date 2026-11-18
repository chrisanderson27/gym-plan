import { describe, expect, it } from 'vitest';
import { createModalStack } from './modalStack';

function setup() {
  const log: string[] = [];
  let inert = false;
  const stack = createModalStack<string>({
    mark: (top) => { inert = true; log.push(`mark:${top}`); },
    clear: () => { inert = false; },
  });
  return { stack, log, isInert: () => inert };
}

describe('modal stack', () => {
  it('only the top entry is top; closing it hands control back while the background stays inert', () => {
    const { stack, log, isInert } = setup();
    stack.push('outer');
    stack.push('inner');
    expect(stack.isTop('inner')).toBe(true);
    expect(stack.isTop('outer')).toBe(false);
    stack.remove('inner');
    expect(stack.isTop('outer')).toBe(true);
    expect(isInert()).toBe(true);
    expect(log.at(-1)).toBe('mark:outer');
    stack.remove('outer');
    expect(isInert()).toBe(false);
  });

  it('out-of-order removal keeps the background inert until the last entry closes', () => {
    const { stack, isInert } = setup();
    stack.push('outer');
    stack.push('inner');
    stack.remove('outer');
    expect(isInert()).toBe(true);
    expect(stack.isTop('inner')).toBe(true);
    stack.remove('inner');
    expect(isInert()).toBe(false);
    expect(stack.size).toBe(0);
  });

  it('ignores removal of an unknown entry', () => {
    const { stack, isInert } = setup();
    stack.push('a');
    stack.remove('zzz');
    expect(isInert()).toBe(true);
    expect(stack.size).toBe(1);
  });
});
