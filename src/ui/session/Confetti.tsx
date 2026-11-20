export function Confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return (
    <span class="session-confetti" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => <span key={i} style={{ '--piece': i }} />)}
    </span>
  );
}
