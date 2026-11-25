import { useState } from 'preact/hooks';
import { saveCssTest } from '../../data/cardio';
import { db } from '../../data/db';
import { cssFromTest } from '../../engine/swim/css';
import { navigate } from '../router';
import { fmtMSS, parseMSS } from './format';

export function CssTestScreen() {
  const [t400, setT400] = useState('');
  const [t200, setT200] = useState('');
  const [t3, setT3] = useState('');
  const [error, setError] = useState('');

  const input = {
    ...(parseMSS(t400) !== undefined ? { t400: parseMSS(t400)! } : {}),
    ...(parseMSS(t200) !== undefined ? { t200: parseMSS(t200)! } : {}),
    ...(parseMSS(t3) !== undefined ? { t3x100: parseMSS(t3)! } : {}),
  };
  const derived = cssFromTest(input);
  const badTime = [t400, t200, t3].some((text) => text.trim() !== '' && parseMSS(text) === undefined);

  const save = async () => {
    try {
      await saveCssTest(db, input);
      navigate('/swim');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  };

  return (
    <main class="screen">
      <header class="bar">
        <h1>CSS test</h1>
        <a class="gear" href="#/swim">Back</a>
      </header>
      <p class="dim">Swim a 400 and a 200 with full rest between, or three 100s and enter their average.</p>
      <label>
        400 time (m:ss)
        <input inputMode="numeric" placeholder="7:00" value={t400} onInput={(e) => setT400(e.currentTarget.value)} />
      </label>
      <label>
        200 time (m:ss)
        <input inputMode="numeric" placeholder="3:20" value={t200} onInput={(e) => setT200(e.currentTarget.value)} />
      </label>
      <label>
        3×100 average (m:ss)
        <input inputMode="numeric" placeholder="1:55" value={t3} onInput={(e) => setT3(e.currentTarget.value)} />
      </label>
      {derived && (
        <p data-testid="css-derived">
          CSS {fmtMSS(derived.per100)} per 100{derived.estimate ? ' (estimate)' : ''}
          {derived.warn && <span class="warn"> {derived.warn}</span>}
        </p>
      )}
      {badTime && <p class="field-error" role="alert">Enter each time as m:ss, greater than 0:00.</p>}
      {error && <p role="alert" class="warn">{error}</p>}
      <button type="button" class="primary" data-testid="css-save" disabled={!derived} onClick={save}>Save</button>
    </main>
  );
}
