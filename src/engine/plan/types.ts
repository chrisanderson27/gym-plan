import type { ISODateTime, LiftVariant, LocalDate, RunKind, SessionType } from '../../data/types';

export interface PlanSession {
  id: string;
  start: ISODateTime;
  end: ISODateTime;
  day: LocalDate;
  type: SessionType;
  hard: boolean;
  hardCardio: boolean;
  variant?: LiftVariant;
  lower: boolean;
  heavyLegs: boolean;
  /** True when the session has working lift sets (counts toward the lifts line). */
  lifted: boolean;
  runKind?: RunKind;
  hardRun: boolean;
  finished: boolean;
}

export type CandidateId =
  | 'lift-upper' | 'lift-lower' | 'hybrid-upper' | 'hybrid-lower' | 'burn'
  | 'run-easy' | 'run-long' | 'run-intervals' | 'swim' | 'rest';
export type Status = 'eligible' | 'warned' | 'blocked';

export interface Candidate {
  id: CandidateId;
  tile: 'lift' | 'hybrid' | 'burn' | 'run' | 'swim' | 'rest';
  title: string;
  route: string;
  variant?: LiftVariant;
  status: Status;
  reasons: string[];
  score: { unmet: number; daysSince: number; readyHoursLeft: number };
}

export interface BudgetLine {
  id: 'hard' | 'lifts' | 'long' | 'swims' | 'rest';
  label: string;
  done: number;
  min: number;
  max: number;
  status: 'under' | 'met' | 'over';
}

export interface PlanInput {
  now: ISODateTime;
  today: LocalDate;
  programStart: LocalDate;
  daysPerWeek: number;
  sessions: PlanSession[];
  lift: Record<'upper' | 'lower', { variant: LiftVariant; ready: boolean; hoursLeft: number; blocking: string[] }>;
  hasLiftHistory: boolean;
}
