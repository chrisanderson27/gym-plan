export interface TaggedExercise {
  id: string;
  tags: readonly string[];
}

/** False when the id is excluded, the id is blocked, or every declared tag is unavailable. */
export function exerciseAllowed(
  exercise: TaggedExercise,
  excluded: ReadonlySet<string>,
  blockedIds: ReadonlySet<string>,
  blockedTags: ReadonlySet<string>,
): boolean {
  if (excluded.has(exercise.id) || blockedIds.has(exercise.id)) return false;
  return !(exercise.tags.length > 0 && exercise.tags.every((tag) => blockedTags.has(tag)));
}
