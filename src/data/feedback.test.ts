import { afterEach, describe, expect, it } from 'vitest';
import * as feedbackModule from './feedback';
import { addFeedback, correctFeedback, listFeedback } from './feedback';
import type { GymDb } from './db';
import { openTestDb } from './test-utils';
import { validateRows } from './validate';

const dbs: GymDb[] = [];
const open = () => {
  const d = openTestDb();
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((d) => d.delete()));
});

const T1 = new Date('2026-11-12T12:00:00.000Z');
const T2 = new Date('2026-11-12T12:05:00.000Z');

describe('feedback writer', () => {
  it('adds then lists newest first, trimming text and ordering tags', async () => {
    const db = open();
    await addFeedback(db, { kind: 'workout', tags: ['other', 'too-easy', 'other'], text: '  hi  ', context: { sessionId: 's1' } }, T1);
    await addFeedback(db, { kind: 'app', tags: [], text: 'later', context: {} }, T2);
    const rows = await listFeedback(db);
    expect(rows.map((r) => r.text)).toEqual(['later', 'hi']);
    expect(rows[1]).toMatchObject({ v: 1, tags: ['too-easy', 'other'], context: { sessionId: 's1' } });
  });

  it('rejects empty input', async () => {
    await expect(addFeedback(open(), { kind: 'app', tags: [], text: '   ', context: {} })).rejects.toThrow();
  });

  it('back-fills ids from the set row', async () => {
    const db = open();
    await db.sets.add({
      id: 'set1', sessionId: 'sess', exerciseId: 'leg-press', equipmentId: 'pin-stack', idx: 0, targetWeight: 100, targetReps: 10,
      weight: 100, reps: 10, painFlag: false, setKind: 'working', ts: T1.toISOString(),
    } as never);
    const id = await addFeedback(db, { kind: 'set', tags: ['pain'], text: '', context: { setId: 'set1', equipmentId: '' } }, T1);
    expect((await db.feedback.get(id))!.context).toEqual({ setId: 'set1', sessionId: 'sess', exerciseId: 'leg-press', equipmentId: 'pin-stack' });
  });

  it('a correction is a new row with ref and copied context; the original is unchanged', async () => {
    const db = open();
    const id = await addFeedback(db, { kind: 'exercise', tags: ['pain'], text: 'a', context: { exerciseId: 'x', screen: '#/lift' } }, T1);
    const original = (await db.feedback.get(id))!;
    const cid = await correctFeedback(db, original, { tags: ['other'], text: 'b' }, T2);
    expect(await db.feedback.get(id)).toEqual(original);
    expect(await db.feedback.get(cid)).toMatchObject({ ref: id, kind: 'exercise', context: { exerciseId: 'x', screen: '#/lift' }, text: 'b' });
  });

  it('exports no update or delete function', () => {
    expect(Object.keys(feedbackModule).sort()).toEqual(['addFeedback', 'correctFeedback', 'listFeedback']);
  });

  it('keeps screen and templateId through import validation, and rejects unknown tags', async () => {
    const db = open();
    await addFeedback(db, { kind: 'workout', tags: ['other'], text: '', context: { screen: '#/burn', templateId: 't' } }, T1);
    const rows = await listFeedback(db);
    expect(() => validateRows('feedback', rows)).not.toThrow();
    expect(() => validateRows('feedback', [{ ...rows[0]!, tags: ['bogus'] }])).toThrow();
  });
});
