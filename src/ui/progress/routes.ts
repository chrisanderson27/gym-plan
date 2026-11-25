export const PROGRESS_ROUTES = {
  history: '/progress/history',
} as const;

/** The canonical allow-list: every route a user can land on, tagged with its Figma frame (or swim / legacy-resume). */
export const MAPPED_ROUTES: readonly { pattern: RegExp; surface: string }[] = [
  { pattern: /^\/$/, surface: 'today' },
  { pattern: /^\/workouts$/, surface: 'workouts' },
  { pattern: /^\/blocks$/, surface: 'blocks' },
  { pattern: /^\/blocks\/(new|suggest|[^/]+)$/, surface: 'block-builder' },
  { pattern: /^\/progress$/, surface: 'progress' },
  { pattern: /^\/progress\/history$/, surface: 'progress' },
  { pattern: /^\/history\/[^/]+$/, surface: 'history-detail' },
  { pattern: /^\/settings$/, surface: 'preferences' },
  { pattern: /^\/workout\/session\/[^/]+$/, surface: 'live-workout' },
  { pattern: /^\/workout\/summary\/[^/]+$/, surface: 'summary' },
  { pattern: /^\/mine\/[^/]+$/, surface: 'workouts' },
  { pattern: /^\/again\/[^/]+$/, surface: 'workouts' },
  { pattern: /^\/swim(\/css)?$/, surface: 'swim' },
  { pattern: /^\/(lift|burn|hybrid)\/session\/[^/]+$/, surface: 'legacy-resume' },
  { pattern: /^\/hybrid\/cardio\/[^/]+$/, surface: 'legacy-resume' },
];

export const isMappedRoute = (route: string) => MAPPED_ROUTES.some((row) => row.pattern.test(route));
export const isLegacyResumeRoute = (route: string) => MAPPED_ROUTES.some((row) => row.surface === 'legacy-resume' && row.pattern.test(route));

/** The single route policy: legacy URLs redirect to the closest mapped surface; unknown routes go to Today. */
export function canonicalRoute(route: string): string {
  if (isMappedRoute(route)) return route;
  if (route === '/history' || route === '/history/') return PROGRESS_ROUTES.history;
  if (['/weigh-in', '/progress/body', '/lift/volume', '/progress/volume'].includes(route)) return '/progress';
  if (route === '/lift/gym') return '/settings';
  if (/^\/(lift|burn|hybrid)\/session(\/|$)|^\/hybrid\/cardio(\/|$)/.test(route)) return '/';
  if (route === '/lift' || route.startsWith('/lift/')) return '/';
  if (/^\/(burn|run|hybrid)(\/|$)/.test(route) || route === '/builder') return '/workouts';
  const builder = /^\/builder\/([^/]+)$/.exec(route);
  if (builder) return `/mine/${builder[1]}`;
  if (route.startsWith('/swim/')) return '/swim';
  return '/';
}
