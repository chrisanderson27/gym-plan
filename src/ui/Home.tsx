import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../data/db';
import { actualDurationSec, cardTitle, loadSessionDetail } from '../data/history';
import { findStaleOpenLifts } from '../data/lift';
import { useLiveQuery } from '../data/live';
import { findOpenMixedSession } from '../data/mixedSession';
import { findTodayLegacyOpen, loadTodayRecommendation, startTodayRecommendation, todaySessionRoute, type TodayDecision } from '../data/recommendation';
import type { Session, Settings } from '../data/types';
import { localDate } from '../engine/dates';
import { streak } from '../engine/plan/ring';
import { weekIndex } from '../engine/week';
import { BackupBanner } from './BackupBanner';
import { loggedLineup } from './history/MixedLoggedLineup';
import { HeroCard, TrainingHeader } from './home/HeroCard';
import { RecommendedLineup, WorkoutLineup } from './home/WorkoutLineup';
import { ArrowRightIcon, ChevronIcon, FlameIcon, LayersIcon, PlayIcon, ProgressIcon, SettingsIcon, WorkoutsIcon } from './icons';
import { useRingInput, WeekCard } from './progress/WeekCard';
import { navigate } from './router';
import { useNow } from './session/hooks';

const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'short' });

export function Home({ settings }: { settings: Settings }) {
  const starting = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [observedOpen, setObservedOpen] = useState<Session>();
  const [review, setReview] = useState<TodayDecision>();
  const day = localDate(new Date(useNow(15_000)));
  const input = useRingInput();
  const latest = useLiveQuery(() => loadTodayRecommendation(db), [day]);
  const sessions = useLiveQuery(async () => {
    const now = new Date();
    const [mixed, legacy, stale] = await Promise.all([findOpenMixedSession(db), findTodayLegacyOpen(db, now), findStaleOpenLifts(db, now)]);
    return { open: mixed ?? legacy, legacy, stale: stale[0] };
  }, [day]);
  const doneId = input?.done?.id;
  const completed = useLiveQuery(async () => {
    if (!doneId) return null;
    const detail = await loadSessionDetail(db, doneId);
    if (!detail) return null;
    const equipment = new Map((await db.equipment.toArray()).map((item) => [item.id, item]));
    return { ...detail, lineup: loggedLineup(detail, equipment, true) };
  }, [doneId]);

  useEffect(() => {
    if (latest) setReview((previous) => previous?.kind === 'workout' ? previous : latest);
  }, [latest]);
  useEffect(() => {
    if (sessions) setObservedOpen(undefined);
  }, [sessions]);
  useEffect(() => {
    if (refreshCount) statusRef.current?.focus();
  }, [refreshCount]);

  const open = sessions?.open ?? observedOpen;
  const done = completed?.session.id === doneId ? completed : null;
  const model = review ?? latest;
  const weekStreak = input && streak(input.sessions, input.programStart, input.today, input.activities);
  const hard = model?.budget.find((line) => line.id === 'hard');
  const planContext = hard && hard.done >= hard.max ? `Hard workouts: ${hard.done} of ${hard.max} maximum` : model?.reason;
  const savedBlocks = done?.session.mixed?.prescription.blocks;
  const completedActivity = done?.session.variant && savedBlocks?.some((block) => block.kind === 'strength')
    && savedBlocks.some((block) => block.kind === 'coached' || block.kind === 'self-paced') ? 'lift' : done?.session.type;
  const choose = <a class="training-link" href="#/workouts">Choose another <ArrowRightIcon /></a>;

  const start = async () => {
    if (starting.current || model?.kind !== 'workout') return;
    starting.current = true;
    setBusy(true);
    setError(false);
    try {
      const result = await startTodayRecommendation(db, model);
      if (result.kind === 'stale') {
        setReview(result.current);
        setRefreshCount((value) => value + 1);
      } else if (result.kind === 'open') {
        setObservedOpen(result.session);
        setRefreshCount((value) => value + 1);
      } else {
        navigate(result.route);
      }
    } catch {
      setError(true);
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  const decisionReady = sessions && (open || done || (!doneId && model));
  return <main class="screen shell-screen today-screen training-screen">
    <TrainingHeader week={weekIndex(day, settings.programStart)} />
    <p class="pref-eyebrow"><span class="workout-dot" />{dateLabel.format(new Date(day + 'T12:00:00'))}</p>
    <h1>Today</h1>
    <p class="pref-lead">Your plan is set. All you have to do is show up.</p>
    <div class="today-content">
      {!decisionReady ? <div class="hero loading-hero" aria-busy="true" aria-label="Loading Today" />
        : open ? <>
          {refreshCount > 0 && <p role="status" class="training-status" tabIndex={-1} ref={statusRef}>A workout is already in progress.</p>}
          <HeroCard state="resume" title={cardTitle(open)} activity={open.type}>
            <a class="btn primary" href={'#' + todaySessionRoute(open)} data-testid="start"><PlayIcon />Resume</a>{choose}
          </HeroCard></>
        : done ? <>
          <HeroCard state="done" title="You showed up." activity={completedActivity}
            detail={`${cardTitle(done.session, done.run)} is in the books. Give yourself some room to recover.`}
            durationSec={actualDurationSec(done.session, done.run)} blockCount={done.lineup.blocks.length || undefined}>
            <a class="btn primary" href="#/progress"><ProgressIcon />View progress</a>
          </HeroCard>
          <WorkoutLineup key={done.session.id} gear={done.lineup.gear} rows={done.lineup.blocks} completed />
        </>
        : <>
          {refreshCount > 0 && <p role="status" class="training-status" tabIndex={-1} ref={statusRef}>
            {model?.kind === 'workout' ? 'Workout changed. Review the updated plan before starting.' : 'Workout changed. No workout was started.'}
          </p>}
          {error && <p role="alert" class="training-status">Could not start the workout. Try again.</p>}
          {model?.kind === 'workout' ? <>
            <HeroCard state="workout" title={model.title} durationSec={model.durationSec} context={planContext}
              detail={`Build ${model.workout.variant.startsWith('lower') ? 'lower' : 'upper'}-body strength, then move through coached intervals and core work.`}
              activity="lift" estimated blockCount={model.workout.prepared.mixed.prescription.blocks.length}>
              <button type="button" class="primary" disabled={busy} data-testid="start" onClick={start}><PlayIcon />{busy ? 'Starting…' : 'Start workout'}</button>
              {choose}
            </HeroCard>
            <RecommendedLineup key={model.revision} recommendation={model} />
          </> : <HeroCard state={model?.kind ?? 'unavailable'} title={model?.kind === 'rest' ? 'Rest day' : 'No compatible workout'} detail={model?.reason}>
            {model?.kind === 'unavailable' && <a class="btn" href="#/settings">Training preferences</a>}
            {choose}
          </HeroCard>}
        </>}
      {sessions?.legacy && open?.mixed && <a class="btn" href={'#' + todaySessionRoute(sessions.legacy)}>
        Resume {cardTitle(sessions.legacy)}
      </a>}
      {!open && sessions?.stale && <a class="btn stale-lift" data-testid="stale-lift" href={'#' + todaySessionRoute(sessions.stale)}>
        Unfinished lift from {dateLabel.format(new Date(sessions.stale.date))}
      </a>}
      {input && <>
        <WeekCard input={input} />
        <p class="streak num" data-testid="streak"><FlameIcon />{weekStreak?.count}-week streak</p>
      </>}
      <section class="training-card training-quick">
        <h2>Quick access</h2>
        {done && !open && choose}
        <a class="training-link" href="#/workouts" aria-labelledby="quick-workouts" aria-describedby="quick-workouts-detail">
          <span class="pref-tile pref-tile-mint"><WorkoutsIcon /></span>
          <span><strong id="quick-workouts">My Workouts</strong><small id="quick-workouts-detail">Ready-to-repeat sessions</small></span>
          <ChevronIcon />
        </a>
        <a class="training-link" href="#/blocks" aria-labelledby="quick-blocks" aria-describedby="quick-blocks-detail">
          <span class="pref-tile quick-blocks-tile"><LayersIcon /></span>
          <span><strong id="quick-blocks">My Blocks</strong><small id="quick-blocks-detail">Mix and match your favorites</small></span>
          <ChevronIcon />
        </a>
      </section>
      <section class="training-card training-preferences">
        <SettingsIcon />
        <h2>Make it yours.</h2>
        <p class="pref-support">Tell us what to skip and which equipment you have. We’ll plan around it.</p>
        <a class="training-link" href="#/settings">Training preferences <ArrowRightIcon /></a>
      </section>
      <BackupBanner settings={settings} />
    </div>
  </main>;
}
