export function RpeChips({ value, onChange, allowSkip }: { value: number | null; onChange: (v: number | null) => void; allowSkip?: boolean }) {
  return (
    <div class="chips" role="group" aria-label="RPE">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" class={value === n ? 'chip on' : 'chip'} data-testid={`rpe-${n}`} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
      {allowSkip && (
        <button type="button" class={value === null ? 'chip on' : 'chip'} data-testid="rpe-skip" onClick={() => onChange(null)}>
          Skip
        </button>
      )}
    </div>
  );
}
