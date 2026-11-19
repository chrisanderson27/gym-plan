import { useRef, useState } from 'preact/hooks';
import { loadCardioSnapshot } from '../data/cardio';
import { db } from '../data/db';
import { findOpenTodayLift, startOrResumePlannedLift } from '../data/lift';
import { useLiveQuery } from '../data/live';
import { loadPlanInput, loadRingInput } from '../data/plan';
import type { Settings } from '../data/types';
import { DEFAULT_LIFT_BUDGET_MIN } from '../engine/config';
import { localDate } from '../engine/dates';
import { programWeekRange } from '../engine/lift/volume';
import { rankToday } from '../engine/plan/pick';
import { streak, weekRing } from '../engine/plan/ring';
import { BackupBanner } from './BackupBanner';
import { HeroCard, heroFor } from './home/HeroCard';
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
  const [day, setDay] = useState(() => localDate(new Date()));
  const home = useLiveQuery(async () => {
    const now = new Date();
    const [plan, input, open] = await Promise.all([loadPlanInput(db, now), loadRingInput(db, now), findOpenTodayLift(db, now)]);
    const ranked = rankToday(plan);
    const { pick } = ranked;
    if (open) {
      const title = open.variant ? variantName(open.variant) : 'Lift';
      return { ranked, input, open, hero: { activity: 'lift' as const, duration: null, title } };
    }
    if (input.done || pick.id === 'rest') return { ranked, input, open, hero: null };
    const cardio = pick.tile === 'run' || pick.tile === 'swim' ? await loadCardioSnapshot(db, now) : null;
    return { ranked, input, open, hero: heroFor(pick, cardio, now) };
  }, [day]);
  if (!home) return <main class="screen today-screen" aria-busy="true"><h1>Today</h1><div class="hero loading-hero" /></main>;

  const { ranked: { pick, reason, budget }, input: { sessions, programStart, today, activities, done }, open, hero } = home;
  const range = programWeekRange(today, programStart);
  const ring = weekRing(sessions, range, activities);
  const { count, freezeAvailable } = streak(sessions, programStart, today, activities);
  const workout = hero !== null;

  return (
    <main class={`screen today-screen${workout ? ' has-start' : ''}`}>
      <header class="today-header">
        <h1 class="num">{dateLabel.format(new Date(today + 'T12:00:00')).replace(',', '')}</h1>
        <Ring ring={ring} budget={budget} freezeAvailable={freezeAvailable} />
      </header>
      <WeekStrip from={range.from} today={today} sessions={sessions} />
      {hero ? (
        <HeroCard state={open ? 'resume' : pick.route.startsWith('#/lift/calibrate/') ? 'first-run' : 'workout'}
          {...hero} reason={open ? 'In progress' : reason} />
      ) : done ? (
        <HeroCard state="done" detail={`${done.variant ? variantName(done.variant) : sessionTypeLabel(done.type)} · ${done.durationMin} min`}
          progress={`${ring.done}/${ring.target}`} />
      ) : <HeroCard state="rest" />}
      <p class="streak num" data-testid="streak"><FlameIcon /> {count}-week streak</p>
      <SomethingElse activities={activities} quiet={!!done} />
      <BackupBanner settings={settings} />
      {workout && (
        <div class="today-start">
          {startError && <p class="error" role="alert">Could not start the lift. Try again.</p>}
          <a class="btn primary" href={open ? `#/lift/session/${open.id}` : pick.route} data-testid="start" onClick={async (event) => {
            const currentDay = localDate(new Date());
            if (today !== currentDay) {
              event.preventDefault();
              setDay(currentDay);
              return;
            }
            if (open || !pick.route.startsWith('#/lift/start/') || !pick.variant || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (starting.current) return;
            starting.current = true;
            setStartError(false);
            try {
              const id = await startOrResumePlannedLift(db, pick.variant, DEFAULT_LIFT_BUDGET_MIN);
              navigate('/lift/session/' + id);
            } catch {
              setStartError(true);
            } finally {
              starting.current = false;
            }
          }}><PlayIcon /> {open ? 'Resume' : 'Start'}</a>
        </div>
      )}
    </main>
  );
}
