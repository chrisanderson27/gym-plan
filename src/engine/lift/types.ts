import type { Equipment, ExerciseOverride, ISODateTime, LocalDate, Session, SetRow } from '../../data/types';

export type { LiftVariant } from '../../data/types';

/** Structural copy of the content `Exercise` — engine may not import content, even as a type. */
export interface LiftExercise {
  id: string;
  group: string;
  equipment: string[];
  primary: string[];
  secondary: string[];
  repClass: 'compound' | 'machine' | 'isolation' | 'other';
  repMin: number;
  repMax: number;
  jointFriendly: boolean;
  substitutes: string[];
}

export type PairKey = `${string}|${string}`;

export interface HistorySession {
  session: Session;
  sets: SetRow[];
}

export interface LiftSnapshot {
  now: ISODateTime;
  programStart: LocalDate;
  /** Ascending by `session.date`. */
  history: HistorySession[];
  overrides: Map<string, ExerciseOverride>;
  equipment: Map<string, Equipment>;
  /** Exercise ids the equipment checklist blocks. Absent means the checklist was not applied. */
  checklistBlocked?: ReadonlySet<string>;
}

export interface Prescription {
  mode: 'calibrate' | 'progress' | 'hold' | 'reduce' | 'repeat' | 'deload';
  weight: number;
  reps: number;
  sets: number;
  rirTarget: number;
  reason: string;
}

export const isWorkingKind = (s: { setKind?: string }): boolean =>
  s.setKind === undefined || s.setKind === 'working';

export const isWorking = (s: { setKind?: string; reps: number }): boolean =>
  isWorkingKind(s) && s.reps > 0;
