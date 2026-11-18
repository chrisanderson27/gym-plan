// FeedbackButton.tsx — slot; P5 fills it. Renders nothing until then.
export interface FeedbackContext { sessionId?: string; exerciseId?: string; setId?: string; equipmentId?: string }
export function FeedbackButton(_props: { kind: 'workout' | 'exercise' | 'set'; context: FeedbackContext }) {
  void _props;
  return null;
}
