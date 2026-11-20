import { useEffect, useRef, useState } from 'preact/hooks';
import { HOME_GYM } from '../../content';
import { BURN_TEMPLATES } from '../../content/burn-templates';
import { finishBurnSession } from '../../data/burn';
import { db } from '../../data/db';
import { discardLiftSession, loadLiftSnapshot, saveCircuitLog, setNotAtMyGym } from '../../data/lift';
import { useLiveQuery } from '../../data/live';
import type { CircuitBlock, CircuitLog } from '../../data/types';
import { blockBeeps, remainingSec } from '../../engine/block/clock';
import { BURN_WARMUP_MIN, TIMER_TICK_MS } from '../../engine/config';
import { zoneOf } from '../../engine/gym/availability';
import { resumeIndex, sessionSteps, upNext, type Step } from '../../engine/lift/focus';
import { sessionPRs, type PR } from '../../engine/pr';
import { beep } from '../../platform/audio';
import { exerciseName, stationEquipmentLabel, zoneLabel } from '../labels';
import { MoreMenu } from '../MoreMenu';
import { navigate } from '../router';
import { Sheet } from '../Sheet';
import { BlockScreen } from '../session/BlockScreen';
import { blockStateKey, restoreBlockState } from '../session/blockState';
import { blockChangeItems } from '../session/changeItems';
import { FinishSheet } from '../session/FinishSheet';
import { useNow, useWakeLock } from '../session/hooks';
import { PrBanner } from '../session/PrBanner';
import { fmtMSS } from './format';

const placeOf = (block: CircuitBlock) => zoneLabel(zoneOf(HOME_GYM, block.podId));

function resumedStep(steps: Step[], sessionId: string): number {
  const index = resumeIndex(steps, []);
  try {
    const running = steps.findIndex((step, i) => i >= index && step.kind === 'circuit'
      && restoreBlockState(JSON.parse(localStorage.getItem(blockStateKey(sessionId, step.block.id)) ?? 'null')).startedAtMs !== null);
    return running < 0 ? index : running;
  } catch {
    return index;
  }
}

export function BurnSessionScreen({ sessionId }: { sessionId: string }) {
  const data = useLiveQuery(async () => {
    const [session, snapshot] = await Promise.all([db.sessions.get(sessionId), loadLiftSnapshot(db)]);
    return { session, snapshot };
  }, [sessionId]);
  const session = data?.session;
  const [i, setI] = useState<number | null>(null);
  const [prompt, setPrompt] = useState<'finish' | 'discard' | null>(null);
  const [record, setRecord] = useState<{ pr: PR; block: CircuitBlock } | null>(null);
  const [error, setError] = useState(false);
  const discarding = useRef(false);
  const now = useNow(TIMER_TICK_MS);
  const started = session ? Date.parse(session.date) : now;
  const active = !!session && !session.endedAt;
  useWakeLock(active);

  const steps = sessionSteps(session?.blocks ?? []);
  const index = i ?? resumedStep(steps, sessionId);
  const step = steps[index];
  const warming = active && step?.kind === 'note' && step.role === 'warmup';
  const remaining = remainingSec(started, BURN_WARMUP_MIN * 60, now);
  const previous = useRef(BURN_WARMUP_MIN * 60);
  useEffect(() => {
    if (session && i === null) setI(index);
  }, [session, i, index]);
  useEffect(() => {
    if (!warming) return;
    for (const sound of blockBeeps(previous.current, remaining)) beep(sound);
    previous.current = remaining;
  }, [warming, remaining]);

  if (!data) return <main class="screen"><h1>Burn</h1></main>;
  if (!session || session.type !== 'burn') {
    return <main class="screen"><h1>Session not found</h1><a class="btn" href="#/burn">Back to Burn</a></main>;
  }

  const { snapshot } = data;
  const templateId = session.templateId;
  const name = BURN_TEMPLATES.find((t) => t.id === templateId)?.name;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const next = steps[index + 1];
  const block = active && step?.kind === 'circuit' ? step.block : undefined;
  const advance = () => setI(index + 1);
  const actions = {
    onFinish: () => setPrompt('finish'),
    onDiscard: () => { setError(false); setPrompt('discard'); },
  };
  const feedback = { kind: 'workout' as const, context: { sessionId, templateId } };
  const leave = <a class="btn session-leave" href="#/" aria-label="Leave session">✕</a>;
  const discard = async () => {
    if (discarding.current) return;
    discarding.current = true;
    try {
      await discardLiftSession(db, sessionId);
      for (const b of session.blocks) {
        if (b.kind !== 'circuit') continue;
        try {
          localStorage.removeItem(blockStateKey(sessionId, b.id));
        } catch {
          // The workout was discarded even if browser storage is unavailable.
        }
      }
      navigate('/');
    } catch {
      setError(true);
      discarding.current = false;
    }
  };
  const saveBlock = async (block: CircuitBlock, log: CircuitLog) => {
    await saveCircuitLog(db, sessionId, block.id, log);
    const blocks = session.blocks.map((b) => b.id === block.id ? { ...block, log } : b);
    const history = snapshot.history.filter((h) => h.session.id !== sessionId && h.session.endedAt && h.session.date <= session.date);
    const pr = sessionPRs({ session: { ...session, blocks }, sets: [] }, history)
      .find((entry) => entry.kind === 'block-work' && entry.blockId === block.id);
    if (pr) setRecord({ pr, block });
    advance();
  };
  const upcoming = upNext(steps, index);

  return (
    <main class="screen lift-session" data-activity="burn">
      {!block && (
        <header class="session-bar">
          {leave}
          <div class="session-heading">
            <h1>Burn{name && ` · ${name}`}</h1>
            {active && <p class="session-progress">Step {Math.min(index + 1, steps.length)} of {steps.length}</p>}
          </div>
          {active && <span class="session-elapsed num" aria-label="Elapsed time">{fmtMSS(elapsed)}</span>}
          <MoreMenu feedback={feedback} items={active ? blockChangeItems(actions) : []} />
        </header>
      )}
      {active ? (
        <>
          {record && <PrBanner key={record.block.id} pr={record.pr} name={record.block.label ?? 'Block'} />}
          {block ? (
            <BlockScreen key={block.id} sessionId={sessionId} block={block} names={exerciseName}
              equipmentName={(station) => stationEquipmentLabel(station, snapshot.equipment)}
              steps={(id) => (id ? snapshot.equipment.get(id)?.steps : undefined) ?? []}
              place={placeOf(block)} headerLeft={leave} changeItems={blockChangeItems(actions)} feedback={feedback}
              onNotAtMyGym={(id) => setNotAtMyGym(db, id, true)} onSkip={advance} onSave={(log) => saveBlock(block, log)} />
          ) : (
            <section class="session-note">
              {warming ? (
                <div class="block-clock burn-warmup">
                  <p>Warm-up</p>
                  <strong class="num" data-testid="burn-warmup-remaining">{fmtMSS(remaining)}</strong>
                </div>
              ) : step?.kind === 'note' && <h2>{step.block.label}</h2>}
              {step?.kind === 'note' && <p>{step.block.notes}</p>}
              <button type="button" class="primary" data-testid="step-next" onClick={next ? advance : actions.onFinish}>
                {next ? `Start ${next.kind === 'circuit' ? next.block.label ?? 'block' : 'cool-down'}` : 'Finish'}
              </button>
            </section>
          )}
          {upcoming.length > 0 && (
            <section class="session-next" data-testid="up-next">
              <h2>Up next</h2>
              <ul>{upcoming.map((s, j) => (
                <li class="num" key={j}>
                  {s.kind === 'circuit' ? `${s.block.label} · ${s.block.durationSec / 60} min · ${placeOf(s.block) ?? 'turf'}`
                    : s.kind === 'note' ? s.block.label : null}
                </li>
              ))}</ul>
            </section>
          )}
        </>
      ) : (
        <section>
          <h2>Finished</h2>
          <ul class="plan">{session.blocks.filter((b) => b.kind === 'circuit').map((b) => (
            <li key={b.id}>{b.label} · {b.log?.completedRounds ?? 0} rounds</li>
          ))}</ul>
        </section>
      )}
      {prompt === 'finish' && (
        <FinishSheet sessionId={sessionId} finish={(rpe, at) => finishBurnSession(db, sessionId, rpe, at)}
          onClose={() => setPrompt(null)} onDone={() => navigate('/')} />
      )}
      {prompt === 'discard' && (
        <Sheet label="Discard this workout?" onClose={() => { if (!discarding.current) setPrompt(null); }}>
          <h2>Discard this workout?</h2>
          <div class="session-actions">
            <button type="button" class="btn" data-testid="discard-confirm" onClick={discard}>Discard</button>
            <button type="button" class="btn" onClick={() => { if (!discarding.current) setPrompt(null); }}>Keep</button>
          </div>
          {error && <p class="error" role="alert">Could not discard the workout. Try again.</p>}
        </Sheet>
      )}
    </main>
  );
}
