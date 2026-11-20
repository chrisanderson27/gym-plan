import { useEffect, useRef, useState } from 'preact/hooks';
import { BURN_TEMPLATES } from '../../content/burn-templates';
import { finishBurnSession } from '../../data/burn';
import { db } from '../../data/db';
import { loadLiftSnapshot, saveCircuitLog, setNotAtMyGym } from '../../data/lift';
import { useLiveQuery } from '../../data/live';
import type { CircuitBlock, CircuitLog } from '../../data/types';
import { blockBeeps, remainingSec } from '../../engine/block/clock';
import { BURN_WARMUP_MIN, TIMER_TICK_MS } from '../../engine/config';
import { resumeIndex, sessionSteps, upNext, type Step } from '../../engine/lift/focus';
import { loggedBlockPR, type PR } from '../../engine/pr';
import { beep } from '../../platform/audio';
import { exerciseName, podLabel, stationEquipmentLabel } from '../labels';
import { MoreMenu } from '../MoreMenu';
import { navigate } from '../router';
import { BlockScreen } from '../session/BlockScreen';
import { blockStateKey, restoreBlockState } from '../session/blockState';
import { blockChangeItems } from '../session/changeItems';
import { DiscardSheet } from '../session/DiscardSheet';
import { FinishSheet } from '../session/FinishSheet';
import { useNow, useWakeLock } from '../session/hooks';
import { PrBanner } from '../session/PrBanner';
import { fmtMSS } from './format';

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
    onDiscard: () => setPrompt('discard'),
  };
  const feedback = { kind: 'workout' as const, context: { sessionId, templateId } };
  const leave = <a class="btn session-leave" href="#/" aria-label="Leave session">✕</a>;
  const saveBlock = async (block: CircuitBlock, log: CircuitLog) => {
    await saveCircuitLog(db, sessionId, block.id, log);
    const pr = loggedBlockPR(session, { ...block, log }, snapshot.history);
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
              place={podLabel(block.podId)} headerLeft={leave} changeItems={blockChangeItems(actions)} feedback={feedback}
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
                  {s.kind === 'circuit' ? `${s.block.label} · ${s.block.durationSec / 60} min · ${podLabel(s.block.podId) ?? 'turf'}`
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
      {prompt === 'discard' && <DiscardSheet session={session} onClose={() => setPrompt(null)} />}
    </main>
  );
}
