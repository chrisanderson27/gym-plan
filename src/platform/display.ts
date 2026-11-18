/** True when launched from the Home Screen (iOS exposes navigator.standalone). */
export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
