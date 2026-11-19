import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildProfile, renderModule } from '../../../scripts/gen-gym.mjs';

const fixturePath = fileURLToPath(new URL('../../../scripts/fixtures/gym-fixture.yaml', import.meta.url));
const fixture = () => parse(readFileSync(fixturePath, 'utf8'));
const keys = (value: object) => Object.keys(value).sort();

describe('gym catalog generator', () => {
  it('emits only allowlisted fields and renders deterministically', () => {
    const { profile } = buildProfile(fixture());
    expect(keys(profile)).toEqual(['id', 'items', 'pods', 'zones']);
    for (const zone of profile.zones) expect(keys(zone)).toEqual(['floor', 'id', 'neighbours']);
    for (const pod of profile.pods) expect(keys(pod)).toEqual(['id', 'items', 'zone']);
    for (const item of profile.items) {
      const allowed = ['confidence', 'count', 'exercises', 'floor', 'id', 'type', 'verified', 'zone'];
      if (item.pending) allowed.push('pending');
      expect(keys(item)).toEqual(allowed.sort());
    }
    const rendered = renderModule(profile);
    expect(rendered).toBe(renderModule(buildProfile(fixture()).profile));
    expect(rendered).not.toMatch(/Fixture|Acme|Fake|fixture-photo|2026-01-01|count_claims|weight_range_lb|walk_note/);
  });

  it('writes a module at the requested CLI output path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gym-profile-'));
    try {
      const script = fileURLToPath(new URL('../../../scripts/gen-gym.mjs', import.meta.url));
      const out = join(dir, 'home-gym.ts');
      const run = spawnSync(process.execPath, [script, fixturePath, '--out', out], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('wrote 13 items, 3 pods, 4 zones');
      expect(run.stderr.trim()).toBe('unmapped exercise: "imaginary lift" (item upper-turf-row)');
      expect(readFileSync(out, 'utf8')).toBe(renderModule(buildProfile(fixture()).profile));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('maps case-insensitively, dedupes aliases and drops only unprogrammable and unmapped phrases', () => {
    const doc = fixture();
    doc.items[0].exercises.push('DUMBBELL RDL');
    const { profile, unmapped } = buildProfile(doc);
    expect(profile.items[0]?.exercises.filter((id) => id === 'romanian-deadlift')).toHaveLength(1);
    expect(profile.items.find((item) => item.id === 'upper-turf-bike')?.exercises).toEqual(['air-bike']);
    expect(unmapped).toEqual(['unmapped exercise: "imaginary lift" (item upper-turf-row)']);
  });

  it('includes located pending items and empty zones, dropping references to awaiting-only stubs', () => {
    const { profile } = buildProfile(fixture());
    expect(profile.zones.map((zone) => zone.id)).toContain('lower-empty');
    expect(profile.items.find((item) => item.id === 'upper-turf-unknown')).toMatchObject({ pending: true, verified: false });
    expect(profile.items.find((item) => item.id === 'upper-turf-strap')?.verified).toBe(true);
    expect(profile.items.some((item) => item.id === 'missing-zone')).toBe(false);
    expect(profile.pods.flatMap((pod) => pod.items)).not.toContain('missing-zone');
  });

  it('rejects a foreign gym id and dangling pod or item references', () => {
    expect(() => buildProfile({ ...fixture(), gym_id: 'fixture-gym' })).toThrow('gym_id');
    const doc = fixture();
    doc.pods[0].items.push('missing-item');
    expect(() => buildProfile(doc)).toThrow('Unknown item for pod');
    doc.pods[0].zone = 'absent-zone';
    expect(() => buildProfile(doc)).toThrow('Unknown zone for pod');
    doc.items[0].zone = 'absent-zone';
    expect(() => buildProfile(doc)).toThrow('Unknown zone for item');
  });
});
