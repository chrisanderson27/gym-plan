import { useEffect, useState } from 'preact/hooks';
import { PR_BANNER_MS } from '../../engine/config';
import type { PR } from '../../engine/pr';
import { Confetti } from './Confetti';

export function PrBanner({ pr, name }: { pr: PR; name: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setVisible(false), PR_BANNER_MS);
    return () => clearTimeout(id);
  }, []);
  if (!visible) return null;

  return (
    <div class="pr-banner num" role="status" data-testid="pr-banner">
      PR · {name}{pr.kind === 'block-work' ? ' · best work' : ` ${pr.weight} lb × ${pr.reps}`}
      <Confetti />
    </div>
  );
}
