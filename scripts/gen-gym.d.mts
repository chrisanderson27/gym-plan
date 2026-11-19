import type { GymProfile } from '../src/content/types';

export const EXERCISE_ALIASES: Readonly<Record<string, string | null>>;
export function buildProfile(doc: unknown): { profile: GymProfile; unmapped: string[] };
export function renderModule(profile: GymProfile): string;
