import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PoseDef } from '../../content/types';
import { anglesAt, gobletDumbbellBounds, HEAD_RADIUS, idleAngles, layout, resolveFrames, skeleton, type Joint, type Layout, type Pt, type Skeleton } from '../../engine/pose';

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
const IMPLEMENT_R = { bar: 5, db: 4, 'goblet-db': 0, kb: 5, handle: 3, none: 0 } as const;
const r1 = (n: number) => Math.round(n * 10) / 10;
const translate = ({ x, y }: Pt) => `translate(${r1(x)} ${r1(y)})`;
const rowerSeat = (hipX: number, railY: number) => [{ x: hipX - 11, y: railY - 5 }, { x: hipX + 11, y: railY - 5 }] as const;
const BIKE_FAN = { x: 69, y: 49, radius: 32 };

function bikeLinks(hip: Pt, sk: Skeleton): [Pt, Pt][] {
  const fan = { x: hip.x + BIKE_FAN.x, y: hip.y + BIKE_FAN.y };
  const crank = { x: hip.x + 35, y: hip.y + 56 };
  return [[fan, sk.wristF], [crank, sk.ankleF], [fan, sk.wristN], [crank, sk.ankleN]];
}

/** Static furniture positioned from frame 0. */
function Prop({ def, lay }: { def: PoseDef; lay: Layout }) {
  const { hip0: h, propRect, viewBox: v, anchorAt: foot } = lay;
  if (def.prop === 'air-bike') return <g class="prop" fill="none" transform={`translate(${h.x} ${h.y})`}>
    <path d="M-22 75H105 M-15 5H10 M-20 75L0 5l35 51 34-7" />
    <circle cx={BIKE_FAN.x} cy={BIKE_FAN.y} r={BIKE_FAN.radius} />
  </g>;
  if (def.prop === 'cable-row') return <g class="prop" fill="none" transform={`translate(${h.x} ${h.y})`}>
    <path d="M-18 40H116V-79H89V40 M-12 10H25 M0 10V40 M76 16H103V-64" />
  </g>;
  if (def.prop === 'plyo-box' && propRect) {
    const { x, y, w, h: height } = propRect;
    const face = w - 14;
    return <path class="prop" fill="none" stroke-linejoin="round" transform={`translate(${r1(x)} ${r1(y)})`}
      d={`M0 10L14 0H${w}V${r1(height - 10)}L${face} ${r1(height)}H0Z M0 10H${face}L${w} 0 M${face} 10V${r1(height)}`} />;
  }
  if (def.prop === 'rower' && propRect) {
    return <g fill="none">
      <rect class="prop" x={r1(propRect.x)} y={r1(propRect.y)} width={r1(propRect.w)} height={propRect.h} />
      <circle class="prop" cx={r1(foot.x + 50)} cy={r1(foot.y - 5)} r={12} />
      <line class="prop" x1={r1(foot.x + 2)} y1={r1(foot.y + 7)} x2={r1(foot.x + 13)} y2={r1(foot.y - 9)} />
    </g>;
  }
  if (propRect) {
    return <rect class="prop" x={r1(propRect.x)} y={r1(propRect.y)} width={propRect.w} height={propRect.h} fill="none" />;
  }
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
  const dumbbell = def.implement === 'goblet-db' ? gobletDumbbellBounds(sk.wristN) : null;
  const seat = def.prop === 'rower' && lay.propRect ? rowerSeat(sk.hip.x, lay.propRect.y) : null;
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
      {def.prop === 'air-bike' && bikeLinks(lay.hip0, sk).map(([a, b], i) => (
        <line class="prop" key={i} ref={reg(`bike-${i}`)} x1={r1(a.x)} y1={r1(a.y)} x2={r1(b.x)} y2={r1(b.y)} />
      ))}
      {seat && <line class="prop" ref={reg('seat')} x1={r1(seat[0].x)} y1={r1(seat[0].y)} x2={r1(seat[1].x)} y2={r1(seat[1].y)} />}
      {cable && <line class="prop" ref={reg('cable')} x1={r1(cable.x)} y1={r1(cable.y)} x2={r1(sk.wristN.x)} y2={r1(sk.wristN.y)} />}
      {SEGMENTS.map((s) => (
        <line key={s.key} class={s.far ? 'bone far' : 'bone'} ref={reg(s.key)} x1={r1(sk[s.a].x)} y1={r1(sk[s.a].y)} x2={r1(sk[s.b].x)} y2={r1(sk[s.b].y)} />
      ))}
      <circle class="head" ref={reg('head')} cx={r1(sk.head.x)} cy={r1(sk.head.y)} r={HEAD_RADIUS} />
      {implR > 0 && <circle class="implement" ref={reg('impl')} cx={r1(sk.wristN.x)} cy={r1(sk.wristN.y)} r={implR} />}
      {dumbbell && (
        <g class="implement" ref={reg('dumbbell')} transform={translate(dumbbell)}>
          <rect x={6} y={8} width={dumbbell.w - 12} height={4} />
          <rect width={7} height={dumbbell.h} rx={1} />
          <rect x={dumbbell.w - 7} width={7} height={dumbbell.h} rx={1} />
        </g>
      )}
    </svg>
  );
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const prefersReduced = () => typeof matchMedia === 'function' && matchMedia(REDUCED).matches;

/** Looped demo with tap-to-pause for standalone figures and a static strip for reduced motion. */
export function StickFigure({ def, label, testId, running }: { def: PoseDef; label: string; testId: string; running?: boolean }) {
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

  useLayoutEffect(() => {
    if (reduced || running === false) return;
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
      if (r.seat && lay.propRect) setLine(r.seat, ...rowerSeat(sk.hip.x, lay.propRect.y));
      if (def.prop === 'air-bike') bikeLinks(lay.hip0, sk).forEach(([a, b], i) => setLine(r[`bike-${i}`] ?? null, a, b));
      r.head?.setAttribute('cx', String(r1(sk.head.x)));
      r.head?.setAttribute('cy', String(r1(sk.head.y)));
      r.impl?.setAttribute('cx', String(r1(sk.wristN.x)));
      r.impl?.setAttribute('cy', String(r1(sk.wristN.y)));
      r.dumbbell?.setAttribute('transform', translate(gobletDumbbellBounds(sk.wristN)));
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
  const idle = running === false;
  // Remount when switching modes because playback writes the SVG attributes directly.
  return (
    <Figure
      key={idle ? 'idle' : 'playing'}
      def={def} lay={lay} sk={skeleton(idle ? idleAngles(def) : anglesAt(def, 0), def.anchor, lay.anchorAt)}
      refs={refs} testId={testId} label={aria}
      running={running ?? true}
      onToggle={running === undefined ? () => { paused.current = !paused.current; } : undefined}
    />
  );
}
