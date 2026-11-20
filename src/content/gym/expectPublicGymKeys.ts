import { expect } from 'vitest';

export function expectPublicGymKeys(profile: {
  zones: readonly { label?: unknown }[];
  pods: readonly object[];
  items: readonly { pending?: unknown }[];
}) {
  expect(Object.keys(profile).sort()).toEqual(['id', 'items', 'pods', 'zones']);
  for (const zone of profile.zones) {
    const keys = ['floor', 'id', 'neighbours'];
    if (zone.label !== undefined) keys.push('label');
    expect(Object.keys(zone).sort()).toEqual(keys.sort());
  }
  for (const pod of profile.pods) expect(Object.keys(pod).sort()).toEqual(['id', 'items', 'zone']);
  for (const item of profile.items) {
    const keys = ['confidence', 'count', 'exercises', 'floor', 'id', 'type', 'verified', 'zone'];
    if (item.pending === true) keys.push('pending');
    expect(Object.keys(item).sort()).toEqual(keys.sort());
  }
}
