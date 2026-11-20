import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CircuitBlock, CircuitLog, CircuitStation } from '../../data/types';
import { blockBeeps, remainingSec } from '../../engine/block/clock';
import { TIMER_TICK_MS } from '../../engine/config';
import { stepBy } from '../../engine/lift/steps';
import { beep, unlockAudio } from '../../platform/audio';
import { MoreMenu, type MenuItem } from '../MoreMenu';
import { Sheet } from '../Sheet';
import { fmtMSS } from '../cardio/format';
import { BlockEndSheet } from './BlockEndSheet';
import { StepperSheet } from './StepperSheet';
import { blockChangeItems } from './changeItems';
import { useNow, useStoredState } from './hooks';

interface BlockState {
  startedAtMs: number | null;
  rounds: number;
  swapped: Record<number, true>;
  loads: Record<number, number>;
}

interface Props {
  sessionId: string;
  block: CircuitBlock;
  names: (exerciseId: string) => string;
  equipmentName: (station: Pick<CircuitStation, 'equipmentId' | 'exerciseId'>) => string | undefined;
  steps: (equipmentId?: string) => number[];
  place?: string;
  headerLeft?: ComponentChildren;
  onSave: (log: CircuitLog) => Promise<void>;
  onSkip: () => void;
  onNotAtMyGym?: (exerciseId: string) => Promise<void>;
  changeItems: MenuItem[];
  feedback: NonNullable<Parameters<typeof MoreMenu>[0]['feedback']>;
}

export function BlockScreen({ sessionId, block, names, equipmentName, steps, place, headerLeft, onSave, onSkip, onNotAtMyGym, changeItems, feedback }: Props) {
  const [state, update, clear] = useStoredState<BlockState>(`block:${sessionId}:${block.id}`, { startedAtMs: null, rounds: 0, swapped: {}, loads: {} });
  const [editing, setEditing] = useState<number | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [unavailableError, setUnavailableError] = useState(false);
  const [endingAt, setEndingAt] = useState<number | null>(null);
  const now = useNow(TIMER_TICK_MS);
  const { startedAtMs } = state;
  const running = startedAtMs !== null;
  const remaining = startedAtMs === null ? block.durationSec : remainingSec(startedAtMs, block.durationSec, now);
  const prev = useRef(remaining);
  const expired = useRef(false);
  useEffect(() => {
    if (!running) return;
    for (const sound of blockBeeps(prev.current, remaining)) beep(sound);
    prev.current = remaining;
    if (remaining === 0 && !expired.current) {
      expired.current = true;
      setEndingAt((at) => at ?? Date.now());
    }
  }, [running, remaining]);

  const actual = (s: CircuitStation, i: number) => state.swapped[i] && s.backup ? s.backup : s;
  const stations = block.stations.map((s, i) => {
    const option = actual(s, i);
    return { ...option, name: names(option.exerciseId), load: state.loads[i] ?? option.load };
  });
  const swap = (i: number, backup?: boolean) => {
    if (editing === i) setEditing(null);
    update((prev) => {
      const swapped = { ...prev.swapped };
      const loads = { ...prev.loads };
      const useBackup = backup ?? !swapped[i];
      if (useBackup === !!swapped[i]) return prev;
      if (useBackup) swapped[i] = true;
      else delete swapped[i];
      delete loads[i];
      return { ...prev, swapped, loads };
    });
  };
  const start = () => {
    unlockAudio();
    update((prev) => prev.startedAtMs === null ? { ...prev, startedAtMs: Date.now() } : prev);
  };
  const addRound = () => {
    update((prev) => prev.startedAtMs !== null && remainingSec(prev.startedAtMs, block.durationSec, Date.now()) > 0
      ? { ...prev, rounds: prev.rounds + 1 } : prev);
  };
  const markUnavailable = async (station: CircuitStation, i: number) => {
    try {
      await onNotAtMyGym?.(station.exerciseId);
      if (station.backup) swap(i, true);
      setChoosing(false);
    } catch {
      setUnavailableError(true);
    }
  };
  const changeLoad = (i: number, direction: -1 | 1) => {
    update((prev) => {
      const s = block.stations[i]!;
      const option = prev.swapped[i] && s.backup ? s.backup : s;
      const load = stepBy(steps(option.equipmentId), prev.loads[i] ?? option.load ?? 0, direction);
      return { ...prev, loads: { ...prev.loads, [i]: load } };
    });
  };
  const save = async (result: Pick<CircuitLog, 'completedRounds' | 'partialReps' | 'lastRoundRir'>) => {
    const actualDurationSec = startedAtMs === null || endingAt === null
      ? 0
      : Math.max(0, Math.min(block.durationSec, Math.round((endingAt - startedAtMs) / 1000)));
    await onSave({
      ...result,
      actualDurationSec,
      stations: stations.map((station, i) => {
        const original = block.stations[i]!;
        return {
          exerciseId: station.exerciseId,
          actualLoad: station.load,
          ...(state.swapped[i] && original.backup ? { swappedFromExerciseId: original.exerciseId } : {}),
        };
      }),
    });
    clear();
  };

  const edited = editing === null ? undefined : stations[editing];
  const items = blockChangeItems({
    onEndBlock: () => setEndingAt(Date.now()),
    onSkipBlock: () => { clear(); onSkip(); },
    onNotAtMyGym: onNotAtMyGym && (() => { setUnavailableError(false); setChoosing(true); }),
  });
  return (
    <section class="session-block" data-testid="block-screen">
      <header class="session-bar">
        {headerLeft}
        <h1>{block.label ?? 'Block'}{place && ` · ${place}`}</h1>
        <MoreMenu feedback={feedback} items={[...items, ...changeItems]} />
      </header>
      <div class="block-clock">
        <p>{running ? 'Repeat for' : `Repeat for ${fmtMSS(block.durationSec)}`}</p>
        {running && <strong class="num" data-testid="block-remaining">{fmtMSS(remaining)}</strong>}
        <p class="num" data-testid="block-round">Round {state.rounds + 1} · target {block.targetRounds}</p>
      </div>
      <ul class="block-stations">
        {stations.map((station, i) => {
          const name = equipmentName(station);
          const content = (
            <>
              <span class="num station-target">{station.target.amount} {station.target.unit === 'sec' ? 's' : station.target.unit}</span>
              <span>{station.name}{name && <small class="dim">{name}</small>}</span>
              {station.load !== undefined && <span class="num station-load">{station.load} lb</span>}
            </>
          );
          return (
            <li key={i}>
              {station.load === undefined ? <div class="block-station">{content}</div> : (
                <button type="button" class="block-station" onClick={() => setEditing(i)}>{content}</button>
              )}
              {block.stations[i]?.backup && (
                <button type="button" class="btn" data-testid={`taken-${i}`} onClick={() => swap(i)}>{state.swapped[i] ? 'Use original' : 'Taken?'}</button>
              )}
            </li>
          );
        })}
      </ul>
      {running ? (
        <button type="button" class={endingAt !== null ? 'btn' : 'primary'} data-testid="round-plus" disabled={remaining === 0} onClick={addRound}>+1 round</button>
      ) : (
        <button type="button" class={endingAt !== null ? 'btn' : 'primary'} data-testid="block-start" onClick={start}>Start block</button>
      )}

      {edited && editing !== null && edited.load !== undefined && (
        <StepperSheet label={edited.name} onClose={() => setEditing(null)} fields={[{
          label: 'Weight', value: edited.load, unit: 'lb',
          onDown: () => changeLoad(editing, -1), onUp: () => changeLoad(editing, 1),
        }]} />
      )}
      {choosing && (
        <Sheet label="Not at my gym" onClose={() => setChoosing(false)}>
          <h2>Not at my gym</h2>
          <div class="sheet-options">
            {block.stations.map((s, i) => (
              <button key={i} type="button" class="btn" onClick={() => markUnavailable(s, i)}>{names(s.exerciseId)}</button>
            ))}
          </div>
          {unavailableError && <p class="error" role="alert">Could not update availability. Try again.</p>}
          <button type="button" class="btn sheet-cancel" onClick={() => setChoosing(false)}>Cancel</button>
        </Sheet>
      )}
      {endingAt !== null && <BlockEndSheet rounds={state.rounds} stations={stations} onClose={() => setEndingAt(null)} onSave={save} />}
    </section>
  );
}
