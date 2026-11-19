import { useState } from 'preact/hooks';
import { db } from '../data/db';
import { DEFAULT_POOL_LENGTH, saveSettings } from '../data/settings';
import type { PoolUnit } from '../data/types';
import { Sheet } from './Sheet';

export function PoolSheet({ onClose }: { onClose: () => void }) {
  const [poolUnit, setPoolUnit] = useState<PoolUnit>('yd');
  const [length, setLength] = useState(String(DEFAULT_POOL_LENGTH));
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Sheet label="Set your pool" onClose={saving ? () => {} : onClose}>
      <h2>Set your pool</h2>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        const poolLength = Number(length === 'custom' ? custom : length);
        if (!Number.isFinite(poolLength) || poolLength <= 0) return setError('Enter a positive pool length.');
        setSaving(true);
        try {
          await saveSettings(db, { poolUnit, poolLength });
        } catch {
          setError('Pool settings could not be saved. Try again.');
          setSaving(false);
        }
      }}>
        <label>
          Pool unit
          <select value={poolUnit} onChange={(event) => setPoolUnit(event.currentTarget.value as PoolUnit)}>
            <option value="yd">yards</option>
            <option value="m">meters</option>
          </select>
        </label>
        <label>
          Pool length
          <select value={length} onChange={(event) => setLength(event.currentTarget.value)}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {length === 'custom' && (
          <label>
            Custom pool length
            <input inputMode="decimal" value={custom} onInput={(event) => setCustom(event.currentTarget.value)} required />
          </label>
        )}
        {error && <p role="alert" class="error">{error}</p>}
        <button class="primary" disabled={saving} type="submit">Save pool</button>
        <button class="btn" disabled={saving} type="button" onClick={onClose}>Cancel</button>
      </form>
    </Sheet>
  );
}
