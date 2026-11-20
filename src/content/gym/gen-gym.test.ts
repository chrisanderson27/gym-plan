import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildProfile, renderModule } from '../../../scripts/gen-gym.mjs';
import { expectPublicGymKeys } from './expectPublicGymKeys';

const fixturePath = fileURLToPath(new URL('../../../scripts/fixtures/gym-fixture.yaml', import.meta.url));
const fixtureKey = 'ab'.repeat(32);
const fixture = () => ({ ...parse(readFileSync(fixturePath, 'utf8')), idKey: fixtureKey });

describe('gym catalog generator', () => {
  it('emits only allowlisted fields and renders deterministically', () => {
    const { profile } = buildProfile(fixture());
    expectPublicGymKeys(profile);
    const rendered = renderModule(profile);
    expect(rendered).toBe(renderModule(buildProfile(fixture()).profile));
    expect(rendered).not.toMatch(/Fixture|Acme|Fake|fixture-photo|2026-01-01|count_claims|weight_range_lb|walk_note/);
  });

  it('publishes only neutral zone labels and omits labels for unfamiliar zones', () => {
    const doc = fixture();
    doc.zones[0].name = 'Private Marker Turf Annex';
    doc.zones[1].name = 'Private Marker Free Weights';
    doc.zones[2].name = 'Private Marker Cardio Deck';
    doc.zones[3].name = 'Private Marker Exclusive Studio';
    doc.zones[3].zone_name = 'Private Marker Exclusive Studio';
    const { profile } = buildProfile(doc);
    expect(profile.zones.map((zone) => zone.label)).toEqual(['turf', 'free weights', 'cardio deck', undefined]);
    expect(renderModule(profile)).not.toContain('Private Marker');

    doc.zones[3].name = 'Rack Room';
    expect(buildProfile(doc).profile.zones[3]?.label).toBe('rack room');
  });

  it('keeps private slugs and free-form types out while preserving references', () => {
    const doc = fixture();
    const item = doc.items[0];
    const pod = doc.pods[1];
    const zone = doc.zones[1];
    doc.zones[0].neighbours = ['private-marker-zone'];
    zone.id = item.zone = doc.items[1].zone = pod.zone = 'private-marker-zone';
    item.id = pod.items[0] = 'private-marker-item';
    pod.id = 'private-marker-pod';
    item.type = 'dumbbell-private-marker';
    const { profile } = buildProfile(doc);
    expect(renderModule(profile)).not.toContain('private-marker');
    expect(profile.items[0]?.type).toBe('dumbbells');
    expect(profile.zones[0]?.neighbours).toEqual([profile.zones[1]?.id]);
    expect(profile.items[0]?.zone).toBe(profile.zones[1]?.id);
    expect(profile.pods[1]?.zone).toBe(profile.zones[1]?.id);
    expect(profile.pods[1]?.items[0]).toBe(profile.items[0]?.id);
    expect(buildProfile({ ...doc, items: [...doc.items].reverse() }).profile.items.find((row) => row.exercises.includes('db-bench') && row.floor === 2)?.id)
      .toBe(profile.items[0]?.id);
  });

  it('keys public ids so a private slug alone cannot reproduce them', () => {
    const doc = fixture();
    const { profile } = buildProfile(doc);
    const other = buildProfile({ ...doc, idKey: 'cd'.repeat(32) }).profile;
    expect(renderModule(profile)).not.toContain(fixtureKey);
    for (const [rows, source, rekeyed, prefix] of [
      [profile.zones, doc.zones, other.zones, 'zone'],
      [profile.items, doc.items, other.items, 'item'],
      [profile.pods, doc.pods, other.pods, 'pod'],
    ] as const) {
      const guess = createHash('sha256').update(source[0].id).digest('hex').slice(0, 16);
      expect(rows[0]?.id).not.toBe(`${prefix}-${guess}`);
      expect(rows[0]?.id).not.toBe(rekeyed[0]?.id);
    }
  });

  it('publishes a neutral elliptical type with its exercise', () => {
    const doc = fixture();
    doc.items[0].type = 'elliptical';
    doc.items[0].exercises = ['elliptical'];
    expect(buildProfile(doc).profile.items[0]).toMatchObject({ type: 'elliptical', exercises: ['elliptical'] });
  });

  it('writes a module at the requested CLI output path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gym-profile-'));
    try {
      const script = fileURLToPath(new URL('../../../scripts/gen-gym.mjs', import.meta.url));
      const out = join(dir, 'home-gym.ts');
      const key = join(dir, 'id-key');
      const args = [script, fixturePath, '--id-key-file', key, '--out', out];
      const missing = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('Could not read private ID key file');
      expect(existsSync(out)).toBe(false);
      writeFileSync(key, 'too-short');
      const invalid = spawnSync(process.execPath, args, { encoding: 'utf8' });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('Expected a private ID key');
      expect(existsSync(out)).toBe(false);
      writeFileSync(key, `${fixtureKey}\n`);
      const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
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
    expect(profile.items.find((item) => item.type === 'bike')?.exercises).toEqual(['air-bike']);
    expect(unmapped).toEqual(['unmapped exercise: "imaginary lift" (item upper-turf-row)']);
  });

  it('includes located pending items and empty zones, dropping references to awaiting-only stubs', () => {
    const { profile } = buildProfile(fixture());
    expect(profile.zones.filter((zone) => !profile.pods.some((pod) => pod.zone === zone.id))).toHaveLength(1);
    expect(profile.items.filter((item) => item.pending)).toEqual([expect.objectContaining({ verified: false })]);
    expect(profile.items.find((item) => item.type === 'strap')?.verified).toBe(true);
    const existing = new Set(profile.items.map((item) => item.id));
    expect(profile.pods.flatMap((pod) => pod.items).every((id) => existing.has(id))).toBe(true);
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

  it.each(['zones', 'items', 'pods', 'pending'])('rejects malformed %s collections and rows', (key) => {
    expect(() => buildProfile({ ...fixture(), [key]: {} })).toThrow(`Expected ${key} to be an array`);
    expect(() => buildProfile({ ...fixture(), [key]: [null] })).toThrow(`Malformed ${key} row`);
  });

  it.each(['zones', 'items', 'pods', 'pending'])('rejects duplicate %s IDs', (key) => {
    const doc = fixture();
    doc[key].push(doc[key][0]);
    expect(() => buildProfile(doc)).toThrow(`Duplicate ${key} id`);
  });

  it('rejects an item ID reused by a located pending item', () => {
    const doc = fixture();
    doc.pending[0].id = doc.items[0].id;
    expect(() => buildProfile(doc)).toThrow('Duplicate pending id');
  });

  it('does not emit an awaiting-only note attached to an existing item as another item', () => {
    const doc = fixture();
    doc.pods[0].items = doc.pods[0].items.filter((id: string) => id !== doc.pending[1].id);
    doc.pending[1].id = doc.items[0].id;
    const { profile } = buildProfile(doc);
    expect(profile.items).toHaveLength(doc.items.length + 1);
    expect(profile.items[0]?.pending).toBeUndefined();
  });
});
