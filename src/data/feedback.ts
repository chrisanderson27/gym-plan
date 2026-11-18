/**
 * Feedback writes. Append-only by PRD §5: a correction is a new row with `ref`, so this module
 * deliberately exports no update or delete function.
 */
import type { GymDb } from './db';
import { newId } from './ids';
import { FEEDBACK_TAGS, type FeedbackKind, type FeedbackRow, type FeedbackTag } from './types';

export interface FeedbackInput {
  kind: FeedbackKind;
  tags: FeedbackTag[];
  text: string;
  context: FeedbackRow['context'];
  ref?: string;
}

export async function addFeedback(db: GymDb, input: FeedbackInput, now = new Date()): Promise<string> {
  const text = input.text.trim();
  const tags = FEEDBACK_TAGS.filter((t) => input.tags.includes(t));
  if (tags.length === 0 && text === '') throw new Error('Pick a tag or write a note');

  const context: FeedbackRow['context'] = {};
  for (const [k, v] of Object.entries(input.context)) {
    if (v !== undefined) (context as Record<string, string>)[k] = v;
  }
  if (context.setId) {
    const set = await db.sets.get(context.setId);
    if (set) {
      context.sessionId ||= set.sessionId;
      context.exerciseId ||= set.exerciseId;
      context.equipmentId ||= set.equipmentId;
    }
  }
  if (context.equipmentId === '') delete context.equipmentId;

  const id = newId();
  const row: FeedbackRow = {
    id, v: 1, ts: now.toISOString(), kind: input.kind, tags, text, context,
    ...(input.ref ? { ref: input.ref } : {}),
  };
  await db.feedback.add(row);
  return id;
}

export const correctFeedback = (
  db: GymDb,
  original: FeedbackRow,
  input: { tags: FeedbackTag[]; text: string },
  now = new Date(),
): Promise<string> => addFeedback(db, { kind: original.kind, context: { ...original.context }, ref: original.id, ...input }, now);

export const listFeedback = (db: GymDb): Promise<FeedbackRow[]> => db.feedback.orderBy('ts').reverse().toArray();
