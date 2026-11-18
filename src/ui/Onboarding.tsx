import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { completeOnboarding, DEFAULT_GOAL_LB, DEFAULT_POOL_LENGTH } from '../data/settings';
import type { PoolUnit } from '../data/types';
import { requestPersistence } from '../platform/storage';
import { navigate } from './router';

export function Onboarding() {
  const [bodyweight, setBodyweight] = useState('');
  const [goal, setGoal] = useState(String(DEFAULT_GOAL_LB));
  const [unit, setUnit] = useState<PoolUnit>('yd');
  const [lengthChoice, setLengthChoice] = useState<'25' | '50' | 'custom'>(String(DEFAULT_POOL_LENGTH) as '25');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    const bw = Number(bodyweight);
    const goalLb = Number(goal);
    const poolLength = lengthChoice === 'custom' ? Number(custom) : Number(lengthChoice);
    if (!(bw >= 80 && bw <= 600)) return setError('Bodyweight must be between 80 and 600 lb.');
    if (!(goalLb > 0)) return setError('Enter a goal weight.');
    if (!(poolLength > 0)) return setError('Enter a pool length.');
    await completeOnboarding(db, { bodyweightLb: bw, goalWeightLb: goalLb, poolUnit: unit, poolLength });
    await requestPersistence();
    navigate('/');
  };

  return (
    <main class="screen">
      <h1>gym-plan</h1>
      <p>Set up once. Your first lift will be a calibration session (Lower A).</p>
      <form onSubmit={submit}>
        <label>
          Bodyweight (lb)
          <input inputMode="decimal" value={bodyweight} onInput={(e) => setBodyweight(e.currentTarget.value)} required />
        </label>
        <label>
          Goal weight (lb)
          <input inputMode="decimal" value={goal} onInput={(e) => setGoal(e.currentTarget.value)} required />
        </label>
        <label>
          Pool unit
          <select value={unit} onChange={(e) => setUnit(e.currentTarget.value as PoolUnit)}>
            <option value="yd">yards</option>
            <option value="m">meters</option>
          </select>
        </label>
        <label>
          Pool length
          <select value={lengthChoice} onChange={(e) => setLengthChoice(e.currentTarget.value as '25')}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {lengthChoice === 'custom' && (
          <label>
            Custom pool length
            <input inputMode="decimal" value={custom} onInput={(e) => setCustom(e.currentTarget.value)} />
          </label>
        )}
        {error && <p class="error" role="alert">{error}</p>}
        <button type="submit" class="primary">
          Start
        </button>
      </form>
    </main>
  );
}
