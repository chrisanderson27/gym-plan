export const PROGRESS_ROUTES = {
  history: '/progress/history',
  body: '/progress/body',
  volume: '/progress/volume',
} as const;

export function canonicalRoute(route: string): string {
  switch (route) {
    case '/history': return PROGRESS_ROUTES.history;
    case '/weigh-in': return PROGRESS_ROUTES.body;
    case '/lift/volume': return PROGRESS_ROUTES.volume;
    default: return route;
  }
}
