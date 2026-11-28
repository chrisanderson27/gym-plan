import { useEffect, useState } from 'preact/hooks';
import { EXERCISES, exerciseById } from '../../content';
import { blockedExerciseIds } from '../../content/equipment-prefs';
import { POSES } from '../../content/poses';
import { stationDemo } from '../../content/stationDemos';
import { db } from '../../data/db';
import { newId } from '../../data/ids';
import { saveLibraryBlock } from '../../data/libraryBlocks';
import { toBlockExercise } from '../../data/liftday';
import { useLiveQuery } from '../../data/live';
import type { LibraryBlock, LibraryStation, Settings, StationUnit } from '../../data/types';
import { STATION_UNITS } from '../../data/types';
import { defaultStationTarget, stationTarget, stationUnits } from '../../engine/block/progression';
import { COACHED_REST_SEC, COACHED_TRANSITION_SEC, COACHED_WORK_SEC } from '../../engine/block/coached';
import { BLOCK_MAX_STATIONS } from '../../engine/templates';
import { exerciseAllowed } from '../../engine/gym/eligibility';
import { localDate } from '../../engine/dates';
import { weekIndex } from '../../engine/week';
import { CalendarIcon, CheckIcon, ChevronIcon, CloseIcon, EyeIcon, PlusIcon } from '../icons';
import { NAME_MAX } from '../labels';
import { StickFigure } from '../pose/StickFigure';
import { useDemoPlayback } from '../pose/playback';
import { navigate } from '../router';
import { Sheet } from '../Sheet';
import { stationGearLabel } from './gearLabel';
import { amountOk, draftFieldProblem, draftFitMinutes, draftProblem, draftWarnings, minutesOk, roundsLine, targetMessage } from './draftCheck';
import { StationCard, stationTargetLine } from './StationCard';

const EMPTY_TAGS: ReadonlySet<string> = new Set();
const SELF_HELP = 'The block clock runs while you move through the stations at your pace.';
const COACHED_HELP = 'Work, rest, and the transition run on their own. The block clock keeps going until the minutes are up.';
const ELIGIBILITY_HELP = 'This block can appear in recommended workouts when it fits your plan and equipment. You can always add it manually.';

interface DraftStation {
  exerciseId: string;
  unit: StationUnit;
  amount: string;
  load: string;
}
interface Draft {
  id: string;
  createdAt?: string;
  name: string;
  kind: 'self-paced' | 'coached';
  minutes: string;
  stations: DraftStation[];
  workSec: number;
  restSec: number;
  transitionSec: number;
  recommend: boolean;
}

const readNumber = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw));

function stationDraft(exerciseId: string): DraftStation {
  const target = defaultStationTarget(toBlockExercise(exerciseById.get(exerciseId)!));
  return { exerciseId, unit: target.unit, amount: String(target.amount), load: '' };
}

function emptyDraft(): Draft {
  return {
    id: newId(), name: '', kind: 'self-paced', minutes: '8', stations: [],
    workSec: Number.NaN, restSec: Number.NaN, transitionSec: Number.NaN, recommend: false,
  };
}

function suggestDraft(): Draft {
  return {
    ...emptyDraft(),
    name: 'Dumbbell & core pairing', kind: 'coached', recommend: false,
    workSec: COACHED_WORK_SEC, restSec: COACHED_REST_SEC, transitionSec: COACHED_TRANSITION_SEC,
    stations: [stationDraft('goblet-squat'), stationDraft('dead-bug')],
  };
}

function fromRow(row: LibraryBlock): Draft {
  return {
    id: row.id, createdAt: row.createdAt, name: row.name, kind: row.kind, recommend: row.recommend,
    minutes: String(row.durationSec / 60),
    workSec: row.workSec ?? Number.NaN, restSec: row.restSec ?? Number.NaN, transitionSec: row.transitionSec ?? Number.NaN,
    stations: row.stations.map((station) => ({
      exerciseId: station.exerciseId, unit: station.target.unit, amount: String(station.target.amount),
      load: station.load === undefined ? '' : String(station.load),
    })),
  };
}

function unitsFor(exerciseId: string): StationUnit[] {
  const exercise = exerciseById.get(exerciseId);
  return exercise ? stationUnits(toBlockExercise(exercise)) : [...STATION_UNITS];
}

export function BlockBuilder({ route, settings }: { route: string; settings: Settings }) {
  const mode = route === '/blocks/new' ? 'new' : route === '/blocks/suggest' ? 'suggest' : 'edit';
  const editId = mode === 'edit' ? route.slice('/blocks/'.length) : undefined;
  const week = weekIndex(localDate(new Date()), settings.programStart);
  const [draft, setDraft] = useState<Draft>(() => (mode === 'suggest' ? suggestDraft() : emptyDraft()));
  const [loaded, setLoaded] = useState(mode !== 'edit');
  const [minutesBad, setMinutesBad] = useState(false);
  const [badTargets, setBadTargets] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'add' | 'preview'>(null);
  const [query, setQuery] = useState('');
  const previewIds = draft.stations.flatMap((station, i) => {
    const exercise = exerciseById.get(station.exerciseId);
    return exercise && stationDemo(exercise) ? [`${i}:${station.exerciseId}`] : [];
  });
  const preview = useDemoPlayback('block-preview', previewIds);

  useEffect(() => {
    if (mode !== 'edit' || !editId) return;
    let stop = false;
    void db.libraryBlocks.get(editId).then((row) => {
      if (stop) return;
      if (row) setDraft(fromRow(row));
      setLoaded(true);
    });
    return () => { stop = true; };
  }, [mode, editId]);

  const overrides = useLiveQuery(() => db.exerciseOverrides.toArray(), []);
  const excluded = new Set((overrides ?? []).filter((row) => row.notAtMyGym).map((row) => row.exerciseId));
  const blockedIds = blockedExerciseIds(EXERCISES, settings.unavailableEquipment ?? []);
  const q = query.trim().toLowerCase();
  const choices = EXERCISES.filter((exercise) => {
    if (!stationDemo(exercise)) return false;
    if (!exerciseAllowed({ id: exercise.id, tags: exercise.equipment }, excluded, blockedIds, EMPTY_TAGS)) return false;
    return exercise.name.toLowerCase().includes(q);
  });

  const problem = draftProblem(draft);
  const valid = problem === undefined;
  const readable = draftFieldProblem(draft) === undefined;
  const warnings = draftWarnings(draft);
  const fitMinutes = draftFitMinutes(draft);
  const stationsTarget = (s: DraftStation) => ({ exerciseId: s.exerciseId, target: { unit: s.unit, amount: Number(s.amount) } });
  const meta = readable ? roundsLine(draft.kind === 'coached'
    ? { kind: 'coached', durationSec: Number(draft.minutes) * 60, stations: draft.stations.map(stationsTarget),
      workSec: draft.workSec, restSec: draft.restSec, transitionSec: draft.transitionSec }
    : { kind: 'self-paced', durationSec: Number(draft.minutes) * 60, stations: draft.stations.map(stationsTarget) }) : undefined;

  const setKind = (kind: Draft['kind']) => {
    setDraft((d) => kind === 'self-paced'
      ? { ...d, kind, workSec: Number.NaN, restSec: Number.NaN, transitionSec: Number.NaN }
      : {
        ...d, kind,
        workSec: Number.isFinite(d.workSec) ? d.workSec : COACHED_WORK_SEC,
        restSec: Number.isFinite(d.restSec) ? d.restSec : COACHED_REST_SEC,
        transitionSec: Number.isFinite(d.transitionSec) ? d.transitionSec : COACHED_TRANSITION_SEC,
      });
  };
  const patchStation = (index: number, partial: Partial<DraftStation>) => {
    setDraft((d) => ({ ...d, stations: d.stations.map((station, i) => (i === index ? { ...station, ...partial } : station)) }));
  };
  const move = (index: number, dir: -1 | 1) => {
    setDraft((d) => {
      const next = d.stations.slice();
      const swap = next[index + dir];
      const current = next[index];
      if (!current || !swap) return d;
      next[index] = swap;
      next[index + dir] = current;
      return { ...d, stations: next };
    });
  };

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    const now = new Date().toISOString();
    const createdAt = draft.createdAt ?? now;
    const stations: LibraryStation[] = draft.stations.map((station) => {
      const row: LibraryStation = { exerciseId: station.exerciseId, target: { unit: station.unit, amount: Number(station.amount) } };
      const load = station.load.trim() === '' ? undefined : Number(station.load);
      if (load !== undefined && load > 0) row.load = load;
      return row;
    });
    const row: LibraryBlock = {
      id: draft.id, name: draft.name.trim().slice(0, NAME_MAX), kind: draft.kind, durationSec: Number(draft.minutes) * 60,
      stations, recommend: draft.recommend, createdAt, updatedAt: now,
    };
    if (draft.kind === 'coached') {
      row.workSec = draft.workSec;
      row.restSec = draft.restSec;
      row.transitionSec = draft.transitionSec;
    }
    try {
      await saveLibraryBlock(db, row);
      navigate('/blocks');
    } catch {
      setDraft((d) => ({ ...d, createdAt }));
      setError('Couldn\'t save this block. Try again.');
      setBusy(false);
    }
  };

  return (
    <main class="screen shell-screen">
      <header class="pref-top">
        <div class="pref-brand">
          <span class="pref-mark" aria-hidden="true"><svg width="16" height="19" viewBox="0 0 16 19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
          <p class="wordmark">Gym Plan.</p>
        </div>
        <p class="week-chip"><CalendarIcon />Week {week}</p>
      </header>
      <a class="block-back" href="#/blocks"><ChevronIcon /> Back</a>
      <p class="pref-eyebrow"><svg class="pref-dot" width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="3" fill="currentColor" /></svg>Workout builder</p>
      <h1>Build a block</h1>
      <p class="pref-lead">Set the pace, order, and targets for this piece of class.</p>
      {loaded && (
        <div class="block-card">
          <label>
            Block name
            <input value={draft.name} maxLength={NAME_MAX} placeholder="e.g. Bench & Core" onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
          </label>
          <div class="block-split">
            <label>
              Block type
              <select aria-label="Block type" value={draft.kind} onChange={(e) => setKind(e.currentTarget.value as Draft['kind'])}>
                <option value="self-paced">Self-paced circuit</option>
                <option value="coached">Coached rotation</option>
              </select>
            </label>
            <label>
              Minutes
              <input
                inputMode="numeric"
                value={draft.minutes}
                aria-invalid={minutesBad ? 'true' : undefined}
                onInput={(e) => {
                  const minutes = e.currentTarget.value;
                  setDraft({ ...draft, minutes });
                  if (minutesBad) setMinutesBad(!minutesOk(minutes));
                }}
                onBlur={(e) => setMinutesBad(!minutesOk(e.currentTarget.value))}
              />
            </label>
          </div>
          {minutesBad && <p>Enter minutes from 1 to 60.</p>}
          {draft.kind === 'coached' && (
            <>
              <label>
                Work (sec)
                <input inputMode="numeric" value={Number.isFinite(draft.workSec) ? String(draft.workSec) : ''} onInput={(e) => setDraft({ ...draft, workSec: readNumber(e.currentTarget.value) })} />
              </label>
              <label>
                Rest (sec)
                <input inputMode="numeric" value={Number.isFinite(draft.restSec) ? String(draft.restSec) : ''} onInput={(e) => setDraft({ ...draft, restSec: readNumber(e.currentTarget.value) })} />
              </label>
              <label>
                Transition (sec)
                <input inputMode="numeric" value={Number.isFinite(draft.transitionSec) ? String(draft.transitionSec) : ''} onInput={(e) => setDraft({ ...draft, transitionSec: readNumber(e.currentTarget.value) })} />
              </label>
            </>
          )}
          <div class="block-order">
            <h2>Station order</h2>
            <span>{draft.stations.length}/{BLOCK_MAX_STATIONS}</span>
          </div>
          {draft.stations.length === 0 && <p>Add a movement to set its target.</p>}
          {draft.stations.map((station, i) => {
            const exercise = exerciseById.get(station.exerciseId);
            const name = exercise?.name ?? station.exerciseId;
            const showLoad = !!exercise && exercise.equipment.some((tag) => tag !== 'bodyweight');
            return (
              <section key={station.exerciseId} class="builder-station">
                <div class="block-station-top">
                  <p class="block-idx">{String(i + 1).padStart(2, '0')}</p>
                  <h3>{name}</h3>
                  <button type="button" class="block-icon up" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronIcon /></button>
                  <button type="button" class="block-icon down" aria-label={`Move ${name} down`} disabled={i === draft.stations.length - 1} onClick={() => move(i, 1)}><ChevronIcon /></button>
                  <button type="button" class="block-icon" aria-label={`Remove ${name}`} onClick={() => setDraft({ ...draft, stations: draft.stations.filter((_, at) => at !== i) })}><CloseIcon /></button>
                </div>
                <div class="block-target">
                  <p>Target</p>
                  <div class="block-chip">
                    <input
                      inputMode="decimal"
                      aria-label={`${name} target`}
                      value={station.amount}
                      aria-invalid={badTargets[station.exerciseId] ? 'true' : undefined}
                      onInput={(e) => {
                        const amount = e.currentTarget.value;
                        patchStation(i, { amount });
                        if (badTargets[station.exerciseId]) setBadTargets((flags) => ({ ...flags, [station.exerciseId]: !amountOk(amount, station.unit) }));
                      }}
                      onBlur={(e) => setBadTargets((flags) => ({ ...flags, [station.exerciseId]: !amountOk(e.currentTarget.value, station.unit) }))}
                    />
                    <select
                      aria-label={`${name} unit`}
                      value={station.unit}
                      onChange={(e) => {
                        const unit = e.currentTarget.value as StationUnit;
                        const next = exercise ? stationTarget(toBlockExercise(exercise), unit) : undefined;
                        patchStation(i, { unit, amount: next ? String(next.amount) : station.amount });
                        setBadTargets((flags) => ({ ...flags, [station.exerciseId]: false }));
                      }}
                    >
                      {unitsFor(station.exerciseId).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                    {showLoad && (
                      <>
                        {station.load.trim() !== '' && <span aria-hidden="true">·</span>}
                        <input inputMode="decimal" aria-label={`${name} load (lb)`} placeholder="Load" value={station.load} onInput={(e) => patchStation(i, { load: e.currentTarget.value })} />
                        {station.load.trim() !== '' && <span>lb</span>}
                      </>
                    )}
                  </div>
                </div>
                {badTargets[station.exerciseId] && <p>{targetMessage(station.unit)}</p>}
              </section>
            );
          })}
          <button type="button" class="block-row" disabled={draft.stations.length >= BLOCK_MAX_STATIONS} onClick={() => { setQuery(''); setSheet('add'); }}><PlusIcon /> Add exercise</button>
          <section class="block-ready">
            <h2>Ready for the gym?</h2>
            <p>{draft.kind === 'coached' ? COACHED_HELP : SELF_HELP}</p>
            <button type="button" class="block-row" disabled={!readable} onClick={() => setSheet('preview')}><EyeIcon /> Preview gym grid</button>
            <label class="check block-eligibility">
              <span>Include in my plan</span>
              <input type="checkbox" checked={draft.recommend} onChange={(e) => setDraft({ ...draft, recommend: e.currentTarget.checked })} />
            </label>
            <p>{ELIGIBILITY_HELP}</p>
            {error && <p role="alert" class="warn">{error}</p>}
            {problem && !(minutesBad && problem.startsWith('Enter minutes')) && !(problem.startsWith('Enter a target') && Object.values(badTargets).some(Boolean)) && <p class="field-error" data-testid="block-problem">{problem}</p>}
            {warnings.length > 0 && (
              <ul class="block-warnings" data-testid="block-warnings">
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            {fitMinutes !== undefined && String(fitMinutes) !== draft.minutes && (
              <button type="button" class="block-row" onClick={() => { setDraft({ ...draft, minutes: String(fitMinutes) }); setMinutesBad(false); }}>Use {fitMinutes} min</button>
            )}
            <button type="button" class="primary" disabled={!valid || busy} onClick={() => { void save(); }}><CheckIcon /> Save to My Blocks</button>
          </section>
        </div>
      )}
      {sheet === 'add' && (
        <Sheet label="Add an exercise" onClose={() => setSheet(null)}>
          <div class="block-sheet-head">
            <div>
              <p class="pref-eyebrow">Exercise library</p>
              <h2>Add an exercise</h2>
            </div>
            <button type="button" class="block-close" aria-label="Close" onClick={() => setSheet(null)}><CloseIcon /></button>
          </div>
          <input class="block-search" aria-label="Search exercises" placeholder="Search exercises" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          {choices.length === 0 && <p>No matching exercises.</p>}
          {choices.map((exercise) => {
            const demo = stationDemo(exercise);
              const pose = demo ? POSES[demo.poseId] : undefined;
            return (
              <button
                key={exercise.id}
                type="button"
                class="block-pick"
                disabled={draft.stations.some((station) => station.exerciseId === exercise.id)}
                onClick={() => {
                  setDraft({ ...draft, stations: [...draft.stations, stationDraft(exercise.id)] });
                  setSheet(null);
                  setQuery('');
                }}
              >
                <span class="block-thumb" aria-hidden="true">
                  {pose && <StickFigure def={pose} label={exercise.name} testId={`pick-${exercise.id}`} running={false} />}
                </span>
                <span class="block-pick-copy">
                  <span class="block-pick-name">{exercise.name}</span>
                  <span class="block-pick-gear">{stationGearLabel(exercise)}</span>
                </span>
                <PlusIcon />
              </button>
            );
          })}
        </Sheet>
      )}
      {sheet === 'preview' && (
        <Sheet label="Block preview" onClose={() => setSheet(null)}>
          <div class="gym-sheet">
            <div class="block-sheet-head">
              <div>
                <p class="pref-eyebrow">Gym display</p>
                <h2>Block preview</h2>
                {meta && <p class="block-meta">{meta} · {draft.minutes} min</p>}
              </div>
              <button type="button" class="block-close" aria-label="Close" onClick={() => setSheet(null)}><CloseIcon /></button>
            </div>
            <div class="gym-grid">
              {draft.stations.map((station, i) => {
                const exercise = exerciseById.get(station.exerciseId);
                return (
                  <StationCard key={station.exerciseId} exerciseId={station.exerciseId} index={i}
                    poseId={exercise ? stationDemo(exercise)?.poseId : undefined}
                    target={stationTargetLine(station.exerciseId, station.amount, station.unit, station.load)}
                    playing={preview.playingId === `${i}:${station.exerciseId}`} onPlay={() => preview.toggle(`${i}:${station.exerciseId}`)} />
                );
              })}
            </div>
          </div>
        </Sheet>
      )}
    </main>
  );
}
