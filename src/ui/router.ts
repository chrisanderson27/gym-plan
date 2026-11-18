import { useEffect, useState } from 'preact/hooks';

const current = () => location.hash.replace(/^#/, '') || '/';

/** Hash routing: GitHub Pages has no SPA fallback, so path routes would 404 on reload. */
export function useRoute(): string {
  const [route, setRoute] = useState(current());
  useEffect(() => {
    const on = () => setRoute(current());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const navigate = (path: string): void => {
  location.hash = path.replace(/^#/, '');
};
