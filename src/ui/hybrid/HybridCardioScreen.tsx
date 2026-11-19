import { useState } from 'preact/hooks';
import { db } from '../../data/db';
import { finishHybridSession } from '../../data/hybrid';
import { useLiveQuery } from '../../data/live';
import type { CardioModality, IntervalBlock, RunBlock } from '../../data/types';
import { HYBRID_LEG_MODALITIES } from '../../engine/config';
import { isLowerVariant } from '../../engine/hybrid';
import { runToIntervals } from '../../engine/run/to-timer';
import { RunLog } from '../cardio/RunLog';
import { TimerScreen } from '../cardio/TimerScreen';
import { modalityName, runKindName } from '../labels';
import { navigate } from '../router';
import { MoreMenu } from '../MoreMenu';

const LEG_OPTIONS = HYBRID_LEG_MODALITIES.map((id) => ({ id: id as CardioModality, label: modalityName(id) }));
const UPPER_OPTIONS: { id: CardioModality; label: string }[] = [{ id: 'run', label: 'Outdoors' }, { id: 'treadmill', label: 'Treadmill' }];

export function HybridCardioScreen({ sessionId }: { sessionId: string }) {
  const session = useLiveQuery(async () => (await db.sessions.get(sessionId)) ?? null, [sessionId]);
  const [stage, setStage] = useState<'plan' | 'timer' | 'log'>('plan');
  const [frozen, setFrozen] = useState<IntervalBlock[]>([]);
  const [timed, setTimed] = useState<{ minutes: number } | null>(null);

  if (session === undefined) return <main class="screen"><h1>Cardio</h1></main>;
  const block = session?.blocks.find((b): b is RunBlock => b.kind === 'run');
  if (!session || !block) {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Session not found</h1>
          <a href="#/hybrid">Back to Hybrid</a>
          <MoreMenu feedback={{ kind: 'workout', context: {} }} />
        </header>
      </main>
    );
  }
  const lower = !!session.variant && isLowerVariant(session.variant);
  const plannedMin = Math.max(1, Math.round((block.repeats * block.segments.reduce((n, s) => n + (s.sec ?? 0), 0)) / 60));

  if (stage === 'timer') {
    return (
      <TimerScreen
        blocks={frozen}
        feedbackContext={{ sessionId }}
        onExit={() => setStage('plan')}
        onFinish={(blocks) => {
          const sec = blocks.reduce((n, b) => n + (b.result?.actualSec ?? 0), 0);
          setTimed({ minutes: Math.max(1, Math.round(sec / 60)) });
          setStage('log');
        }}
      />
    );
  }

  if (stage === 'log') {
    return (
      <main class="screen">
        <header class="bar">
          <h1>Log cardio</h1>
          <MoreMenu feedback={{ kind: 'workout', context: { sessionId } }} />
        </header>
        <RunLog
          defaultMinutes={timed?.minutes ?? plannedMin}
          defaultModality={block.modality}
          modalities={lower ? LEG_OPTIONS : UPPER_OPTIONS}
          onSave={async (v) => { await finishHybridSession(db, sessionId, v); navigate('/'); }}
        />
      </main>
    );
  }

  return (
    <main class="screen">
      <header class="bar">
        <h1>Hybrid cardio</h1>
        <a class="gear" href="#/">Home</a>
        <MoreMenu feedback={{ kind: 'workout', context: { sessionId } }} />
      </header>
      <p data-testid="hybrid-cardio-planned"><strong>{modalityName(block.modality)} · {plannedMin} min</strong> ({runKindName(block.runKind)})</p>
      {/* The lift part was the warm-up, so the timer adds none. */}
      <button type="button" class="primary" data-testid="hybrid-timer-start" onClick={() => { setFrozen(runToIntervals(block, { warmupSec: 0, cooldownSec: 0 })); setStage('timer'); }}>Start timer</button>
      <button type="button" data-testid="hybrid-log-direct" onClick={() => { setTimed(null); setStage('log'); }}>Log without timer</button>
    </main>
  );
}
