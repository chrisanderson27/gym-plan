import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PoseDef } from '../../content/types';
import { anglesAt, HEAD_RADIUS, layout, resolveFrames, skeleton, type Joint, type Layout, type Skeleton } from '../../engine/pose';

const SEGMENTS: { key: string; a: Joint; b: Joint; far?: boolean }[] = [
  { key: 'torso', a: 'hip', b: 'neck' },
  { key: 'armF1', a: 'neck', b: 'elbowF', far: true },
  { key: 'armF2', a: 'elbowF', b: 'wristF', far: true },
  { key: 'legF1', a: 'hip', b: 'kneeF', far: true },
  { key: 'legF2', a: 'kneeF', b: 'ankleF', far: true },
  { key: 'legF3', a: 'ankleF', b: 'toeF', far: true },
  { key: 'legN1', a: 'hip', b: 'kneeN' },
  { key: 'legN2', a: 'kneeN', b: 'ankleN' },
  { key: 'legN3', a: 'ankleN', b: 'toeN' },
  { key: 'armN1', a: 'neck', b: 'elbowN' },
  { key: 'armN2', a: 'elbowN', b: 'wristN' },
];
const IMPLEMENT_R = { bar: 5, db: 4, kb: 5, handle: 3, none: 0 } as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Static furniture, drawn relative to frame 0's hip (and across the whole view box for the floor). */
function Prop({ def, lay }: { def: PoseDef; lay: Layout }) {
  const { hip0: h, viewBox: v } = lay;
  switch (def.prop) {
    case 'bench':
      return <line class="prop" x1={r1(h.x - 55)} y1={r1(h.y + 8)} x2={r1(h.x + 15)} y2={r1(h.y + 8)} />;
    case 'seat':
      return (
        <>
          <line class="prop" x1={r1(h.x - 16)} y1={r1(h.y + 8)} x2={r1(h.x + 16)} y2={r1(h.y + 8)} />
          <line class="prop" x1={r1(h.x - 12)} y1={r1(h.y + 4)} x2={r1(h.x - 12)} y2={r1(h.y - 50)} />
        </>
      );
    case 'incline':
      return <line class="prop" x1={r1(h.x - 6)} y1={r1(h.y + 8)} x2={r1(h.x - 46)} y2={r1(h.y - 36)} />;
    case 'floor':
      return <line class="prop" x1={r1(v.x)} y1={r1(h.y + 8)} x2={r1(v.x + v.w)} y2={r1(h.y + 8)} />;
    default:
      return null;
  }
}

function setLine(el: Element | null, a: { x: number; y: number }, b: { x: number; y: number }) {
  if (!el) return;
  el.setAttribute('x1', String(r1(a.x)));
  el.setAttribute('y1', String(r1(a.y)));
  el.setAttribute('x2', String(r1(b.x)));
  el.setAttribute('y2', String(r1(b.y)));
}

function Figure({ def, lay, sk, refs, testId, label, onToggle, running }: {
  def: PoseDef; lay: Layout; sk: Skeleton;
  refs?: { current: Record<string, Element | null> };
  testId?: string; label: string; onToggle?: () => void;
  running?: boolean;
}) {
  const { viewBox: v, anchorAt } = lay;
  const reg = (key: string) => (el: Element | null) => { if (refs) refs.current[key] = el; };
  const cable = def.cable ? { x: anchorAt.x + def.cable.x, y: anchorAt.y + def.cable.y } : null;
  const implR = IMPLEMENT_R[def.implement ?? 'none'];
  return (
    <svg
      class="pose"
      viewBox={`${r1(v.x)} ${r1(v.y)} ${r1(v.w)} ${r1(v.h)}`}
      role="img"
      aria-label={label}
      data-testid={testId}
      data-running={running === undefined ? undefined : running ? 'true' : 'false'}
      onClick={onToggle}
    >
      <Prop def={def} lay={lay} />
      {cable && <line class="prop" ref={reg('cable')} x1={r1(cable.x)} y1={r1(cable.y)} x2={r1(sk.wristN.x)} y2={r1(sk.wristN.y)} />}
      {SEGMENTS.map((s) => (
        <line key={s.key} class={s.far ? 'bone far' : 'bone'} ref={reg(s.key)} x1={r1(sk[s.a].x)} y1={r1(sk[s.a].y)} x2={r1(sk[s.b].x)} y2={r1(sk[s.b].y)} />
      ))}
      <circle class="head" ref={reg('head')} cx={r1(sk.head.x)} cy={r1(sk.head.y)} r={HEAD_RADIUS} />
      {implR > 0 && <circle class="implement" ref={reg('impl')} cx={r1(sk.wristN.x)} cy={r1(sk.wristN.y)} r={implR} />}
    </svg>
  );
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const prefersReduced = () => typeof matchMedia === 'function' && matchMedia(REDUCED).matches;

/** Looped stick-figure demo; a static filmstrip when reduced motion is on. Tap to pause. `running` false holds frame 0 so a preview can play one figure. */
export function StickFigure({ def, label, testId, running = true }: { def: PoseDef; label: string; testId: string; running?: boolean }) {
  const lay = useMemo(() => layout(def), [def]);
  const [reduced, setReduced] = useState(prefersReduced);
  const paused = useRef(false);
  const refs = useRef<Record<string, Element | null>>({});

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(REDUCED);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (reduced || !running) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const frame = (now: number) => {
      if (!paused.current) elapsed += now - last;
      last = now;
      const sk = skeleton(anglesAt(def, elapsed), def.anchor, lay.anchorAt);
      const r = refs.current;
      for (const s of SEGMENTS) setLine(r[s.key] ?? null, sk[s.a], sk[s.b]);
      if (r.cable) setLine(r.cable, { x: lay.anchorAt.x + (def.cable?.x ?? 0), y: lay.anchorAt.y + (def.cable?.y ?? 0) }, sk.wristN);
      r.head?.setAttribute('cx', String(r1(sk.head.x)));
      r.head?.setAttribute('cy', String(r1(sk.head.y)));
      r.impl?.setAttribute('cx', String(r1(sk.wristN.x)));
      r.impl?.setAttribute('cy', String(r1(sk.wristN.y)));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [def, lay, reduced, running]);

  const aria = `${label} demonstration`;
  if (reduced) {
    return (
      <div class="pose-strip" role="img" aria-label={aria} data-testid={testId} data-static="true">
        {resolveFrames(def).map((a, i) => (
          <Figure key={i} def={def} lay={lay} sk={skeleton(a, def.anchor, lay.anchorAt)} label={`${label} step ${i + 1}`} />
        ))}
      </div>
    );
  }
  // First frame is drawn synchronously, so the figure exists before any rAF fires.
  return (
    <Figure
      def={def} lay={lay} sk={skeleton(anglesAt(def, 0), def.anchor, lay.anchorAt)} refs={refs} testId={testId} label={aria}
      running={running}
      onToggle={() => { paused.current = !paused.current; }}
    />
  );
}
