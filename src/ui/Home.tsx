import { useRef, useState } from 'preact/hooks';
import { buildLiftPlan, loadLiftSnapshot, startLiftSession } from '../data/lift';
import { db } from '../data/db';
import { useLiveQuery } from '../data/live';
import { loadPlanInput, loadRingInput } from '../data/plan';
import type { Settings } from '../data/types';
import { DEFAULT_LIFT_BUDGET_MIN } from '../engine/config';
import { programWeekRange } from '../engine/lift/volume';
import { rankToday } from '../engine/plan/pick';
import { streak, weekRing } from '../engine/plan/ring';
import { BackupBanner } from './BackupBanner';
import { HeroCard } from './home/HeroCard';
import { Ring } from './home/Ring';
import { SomethingElse } from './home/SomethingElse';
import { WeekStrip } from './home/WeekStrip';
import { FlameIcon, PlayIcon } from './icons';
import { sessionTypeLabel, variantName } from './labels';
import { navigate } from './router';

const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

export function Home({ settings }: { settings: Settings }) {
  const starting = useRef(false);
  const [startError, setStartError] = useState(false);
  const home = useLiveQuery(async () => {
    const now = new Date();
    const [plan, input] = await Promise.all([loadPlanInput(db, now), loadRingInput(db, now)]);
    return { ranked: rankToday(plan), input };
  }, []);
  if (!home) return <main class="screen today-screen" aria-busy="true"><h1>Today</h1><div class="hero loading-hero" /></main>;

  const { ranked: { pick, reason, budget }, input: { sessions, programStart, today, activities, done } } = home;
  const range = programWeekRange(today, programStart);
  const ring = weekRing(sessions, range, activities);
  const { count, freezeAvailable } = streak(sessions, programStart, today, activities);
  const workout = !done && pick.id !== 'rest';

  return (
    <main class={`screen today-screen${workout ? ' has-start' : ''}`}>
      <header class="today-header">
        <h1 class="num">{dateLabel.format(new Date(today + 'T12:00:00')).replace(',', '')}</h1>
        <Ring ring={ring} budget={budget} freezeAvailable={freezeAvailable} />
      </header>
      <WeekStrip from={range.from} today={today} sessions={sessions} />
      {done ? (
        <HeroCard state="done" detail={`${done.variant ? variantName(done.variant) : sessionTypeLabel(done.type)} · ${done.durationMin} min`}
          progress={`${ring.done}/${ring.target}`} />
      ) : pick.id === 'rest' ? <HeroCard state="rest" /> : (
        <HeroCard state={pick.route.startsWith('#/lift/calibrate/') ? 'first-run' : 'workout'} pick={pick} settings={settings} reason={reason} />
      )}
      <p class="streak num" data-testid="streak"><FlameIcon /> {count}-week streak</p>
      <SomethingElse activities={activities} quiet={!!done} />
      <BackupBanner settings={settings} />
      {workout && (
        <div class="today-start">
          {startError && <p class="error" role="alert">Could not start the lift. Try again.</p>}
          <a class="btn primary" href={pick.route} data-testid="start" onClick={async (event) => {
            if (!pick.route.startsWith('#/lift/start/') || !pick.variant || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (starting.current) return;
            starting.current = true;
            setStartError(false);
            try {
              const snapshot = await loadLiftSnapshot(db);
              const plan = buildLiftPlan(snapshot, pick.variant, DEFAULT_LIFT_BUDGET_MIN);
              const id = await startLiftSession(db, plan);
              navigate('/lift/session/' + id);
            } catch {
              setStartError(true);
            } finally {
              starting.current = false;
            }
          }}><PlayIcon /> Start</a>
        </div>
      )}
    </main>
  );
}
