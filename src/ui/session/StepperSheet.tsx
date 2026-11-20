import { Sheet } from '../Sheet';
import { Stepper } from '../lift/Stepper';

export interface StepperField {
  label: string;
  value: number;
  unit: string;
  testId?: string;
  onDown: () => void;
  onUp: () => void;
}

export function StepperSheet({ label, fields, onClose }: { label: string; fields: StepperField[]; onClose: () => void }) {
  return (
    <Sheet label={label} onClose={onClose}>
      <h2>{label}</h2>
      {fields.map((field) => (
        <div key={field.label} class="session-stepper">
          <span>{field.label}</span>
          <Stepper wide={field.unit === 'lb'} value={field.value} unit={field.unit} valueTestId={field.testId}
            downLabel={field.label.toLowerCase() + ' down'} upLabel={field.label.toLowerCase() + ' up'}
            onDown={field.onDown} onUp={field.onUp} />
        </div>
      ))}
      <button type="button" class="btn sheet-cancel" onClick={onClose}>Done</button>
    </Sheet>
  );
}
