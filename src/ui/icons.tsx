import type { ComponentChildren } from 'preact';
import type { Activity } from '../engine/plan/activities';

function icon(children: ComponentChildren) {
  return function Icon() {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        {children}
      </svg>
    );
  };
}

export const LiftIcon = icon(<path d="M2 12h2m4 0h8m4 0h2M4 8h4v8H4zm12 0h4v8h-4z" />);
export const BurnIcon = icon(<path d="m13 2-9 12h7l-1 8 10-12h-7z" />);
export const RunIcon = icon(<><circle cx="16" cy="4" r="2" /><path d="m6 8 5-1 5 5 4-1m-7-2-3 6 5 3v4M3 20l4-1 3-4" /></>);
export const SwimIcon = icon(<><circle cx="17" cy="8" r="2" /><path d="m4 13 5-4 5 4m-12 3c3 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2M2 21c3 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2" /></>);
export const TodayIcon = icon(<path d="m3 10 9-7 9 7v10H3zm7 10v-6h4v6" />);
export const ProgressIcon = icon(<path d="M3 3v18h18M8 16v-4m5 4V8m5 8V4" />);
export const SettingsIcon = icon(<><path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6" /></>);
export const MoreIcon = icon(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const ChangeIcon = icon(<path d="M3 7h18M3 17h18M8 4v6m8 4v6" />);
export const SwapIcon = icon(<path d="M3 8h17m-4-4 4 4-4 4M21 16H4m4-4-4 4 4 4" />);
export const TimerIcon = icon(<><circle cx="12" cy="14" r="7" /><path d="M10 2h4m-2 5V2m0 9v4l2 1" /></>);
export const CheckIcon = icon(<path d="m5 12 4 4L19 6" />);
export const PlayIcon = icon(<path d="m8 5 11 7-11 7z" />);
export const ChevronIcon = icon(<path d="m9 6 6 6-6 6" />);
export const CloseIcon = icon(<path d="m6 6 12 12M18 6 6 18" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const RingIcon = icon(<path d="M12 3a9 9 0 1 0 9 9h-9z" />);
export const FlameIcon = icon(<path d="M12 2c1 6 7 7 7 13a7 7 0 0 1-14 0c0-3 2-5 4-7 0 2 1 3 2 3 2-3 1-6 1-9Z" />);
export const ScaleIcon = icon(<path d="M4 4h16v16H4zm4 7a4 4 0 0 1 8 0m-4-1 1-2" />);
export const HistoryIcon = icon(<path d="M3 12a9 9 0 1 1 3 7M3 6v6h6m3-5v5l4 2" />);

const ACTIVITY_ICONS = { lift: LiftIcon, burn: BurnIcon, run: RunIcon, swim: SwimIcon };

export function ActivityIcon({ activity }: { activity: Activity }) {
  const Icon = ACTIVITY_ICONS[activity];
  return <Icon />;
}
