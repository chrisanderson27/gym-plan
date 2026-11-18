/** − value + as one 56 px-tall control; each button is at least 56 px wide, the value cell never changes width. */
export function Stepper({
  value, unit, valueTestId, downLabel, upLabel, wide, onDown, onUp,
}: {
  value: number;
  unit: string;
  valueTestId?: string;
  downLabel: string;
  upLabel: string;
  /** Weight values can reach "102.5": the wide cell keeps the row from reflowing as they grow. */
  wide?: boolean;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <div class={wide ? 'stepper wide' : 'stepper'}>
      <button type="button" aria-label={downLabel} onClick={onDown}>−</button>
      <span class="valbox">
        <span class="val" {...(valueTestId ? { 'data-testid': valueTestId } : {})}>{value}</span>
        <small aria-hidden="true">{unit}</small>
      </span>
      <button type="button" aria-label={upLabel} onClick={onUp}>+</button>
    </div>
  );
}
