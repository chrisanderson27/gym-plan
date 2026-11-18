import type { RunBlock, RunSegment } from '../data/types';

export interface RunFormatBand {
  fromWeek: number;
  repeats: number;
  segments: RunSegment[];
}
export interface RunFormatDef {
  format: NonNullable<RunBlock['format']>;
  name: string;
  modality: 'run' | 'treadmill';
  minWeek: number;
  bands: RunFormatBand[];
}

const sp = (sec: number): RunSegment => ({ role: 'sprint', sec });
const wk = (sec: number): RunSegment => ({ role: 'walk', sec });
const jg = (sec: number): RunSegment => ({ role: 'jog', sec });
const rn = (sec: number): RunSegment => ({ role: 'run', sec });

/** `rpeTarget` is stamped by the generator, never stored here. */
export const RUN_FORMATS: RunFormatDef[] = [
  { format: 'sprint-walk', name: 'Sprint / walk', modality: 'run', minWeek: 1, bands: [
    { fromWeek: 1, repeats: 6, segments: [sp(15), wk(90)] },
    { fromWeek: 3, repeats: 8, segments: [sp(20), wk(75)] },
    { fromWeek: 6, repeats: 10, segments: [sp(20), wk(60)] },
  ] },
  { format: 'hill', name: 'Hill repeats', modality: 'run', minWeek: 1, bands: [
    { fromWeek: 1, repeats: 5, segments: [sp(30), wk(90)] },
    { fromWeek: 3, repeats: 8, segments: [sp(45), wk(90)] },
    { fromWeek: 6, repeats: 8, segments: [sp(60), wk(90)] },
  ] },
  { format: 'treadmill-incline', name: 'Treadmill incline', modality: 'treadmill', minWeek: 1, bands: [
    { fromWeek: 1, repeats: 6, segments: [{ ...rn(60), inclinePct: 8 }, { ...wk(120), inclinePct: 1 }] },
    { fromWeek: 3, repeats: 8, segments: [{ ...rn(90), inclinePct: 10 }, { ...wk(120), inclinePct: 1 }] },
  ] },
  { format: 'sprint-jog', name: 'Sprint / jog', modality: 'run', minWeek: 3, bands: [
    { fromWeek: 3, repeats: 6, segments: [sp(30), jg(90)] },
    { fromWeek: 6, repeats: 8, segments: [sp(30), jg(75)] },
  ] },
  { format: '30-30', name: '30 / 30', modality: 'run', minWeek: 3, bands: [
    { fromWeek: 3, repeats: 8, segments: [rn(30), jg(30)] },
    { fromWeek: 6, repeats: 12, segments: [rn(30), jg(30)] },
  ] },
  { format: 'norwegian-4x4', name: 'Norwegian 4×4', modality: 'run', minWeek: 4, bands: [
    { fromWeek: 4, repeats: 3, segments: [rn(240), jg(180)] },
    { fromWeek: 6, repeats: 4, segments: [rn(240), jg(180)] },
  ] },
];
