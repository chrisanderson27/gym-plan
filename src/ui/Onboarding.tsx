import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { completeOnboarding, onboardingGoalError } from '../data/settings';
import { GOAL_DIRECTIONS, type GoalDirection } from '../data/types';
import { ACTIVITIES, type Activity } from '../engine/plan/activities';
import { requestPersistence } from '../platform/storage';
import { ActivityIcon } from './icons';
import { sessionTypeLabel } from './labels';
import { navigate } from './router';

export function ActivityChoices({ activities, onChange, onboarding }: {
  activities: readonly Activity[]; onChange: (next: Activity[]) => void; onboarding?: boolean;
}) {
  return (
    <div class="chips activity-choices" role="group" aria-label="Activities">
      {ACTIVITIES.map((activity) => {
        const selected = activities.includes(activity);
        return (
          <button key={activity} type="button" class={selected ? 'chip on' : 'chip'} aria-pressed={selected}
            data-testid={onboarding ? `onb-act-${activity}` : `activity-${activity}`}
            onClick={() => onChange(selected ? activities.filter((a) => a !== activity) : [...activities, activity])}>
            <span class="activity-icon" data-activity={activity}><ActivityIcon activity={activity} /></span>
            {sessionTypeLabel(activity)}
          </button>
        );
      })}
    </div>
  );
}

export function DirectionChoices({ direction, onChange }: { direction: GoalDirection; onChange: (direction: GoalDirection) => void }) {
  return (
    <div class="chips direction-choices" role="group" aria-label="Goal direction">
      {GOAL_DIRECTIONS.map((value) => (
        <button key={value} type="button" class={direction === value ? 'chip on' : 'chip'} aria-pressed={direction === value}
          onClick={() => onChange(value)}>{sessionTypeLabel(value)}</button>
      ))}
    </div>
  );
}

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([...ACTIVITIES]);
  const [bodyweight, setBodyweight] = useState('');
  const [goal, setGoal] = useState('');
  const [direction, setDirection] = useState<GoalDirection>('lose');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const move = (next: number) => { setError(''); setStep(next); };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (saving) return;
    if (step === 1 && !activities.length) return;
    const bw = Number(bodyweight);
    if (step >= 2 && !(bw >= 80 && bw <= 600)) return setError('Bodyweight must be between 80 and 600 lb.');
    if (step < 3) {
      if (step === 2 && direction === 'maintain') setGoal(bodyweight);
      return move(step + 1);
    }
    const goalLb = Number(goal);
    const goalError = onboardingGoalError(bw, goalLb, direction);
    if (goalError) return setError(goalError);
    setSaving(true);
    try {
      await completeOnboarding(db, { bodyweightLb: bw, goalWeightLb: goalLb, goalDirection: direction, activities });
      await requestPersistence();
      navigate('/');
    } catch {
      setError('Setup could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const title = ['gym-plan', 'What do you train?', 'What do you weigh?', 'What’s your goal?'][step];

  return (
    <main class="screen onboarding" data-step={step}>
      {step > 0 && (
        <div class="step-dots" role="img" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((n) => <i key={n} class={step >= n ? 'current' : ''} />)}
        </div>
      )}
      <h1>{title}</h1>
      {step === 0 ? (
        <>
          <p>Know what to train today and see your week fill up.</p>
          <button type="button" class="primary" onClick={() => move(1)}>Get started</button>
        </>
      ) : (
        <form onSubmit={submit}>
          {step === 1 && (
            <>
              <ActivityChoices activities={activities} onChange={setActivities} onboarding />
              {!activities.length && <p role="status">Choose at least one activity.</p>}
            </>
          )}
          {step === 2 && (
            <label>
              Bodyweight (lb)
              <input inputMode="decimal" value={bodyweight} onInput={(e) => setBodyweight(e.currentTarget.value)} required />
            </label>
          )}
          {step === 3 && (
            <>
              <DirectionChoices direction={direction} onChange={(next) => {
                setDirection(next);
                if (next === 'maintain') setGoal(bodyweight);
                else if (direction === 'maintain') setGoal('');
              }} />
              <label>
                Target weight (lb)
                <input inputMode="decimal" value={goal} onInput={(e) => setGoal(e.currentTarget.value)} required />
              </label>
            </>
          )}
          {error && <p class="error" role="alert">{error}</p>}
          <button type="submit" class="primary" disabled={saving || !activities.length}>{step === 3 ? 'Start' : 'Next'}</button>
          <button type="button" class="btn" disabled={saving} onClick={() => move(step - 1)}>Back</button>
        </form>
      )}
    </main>
  );
}
