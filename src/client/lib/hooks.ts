import { useEffect, useState, useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', callback);
      return () => mq.removeEventListener('change', callback);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

export type Route =
  | { name: 'home' }
  | { name: 'new'; eventType: 'wedding' | 'birthday' | 'community' | null }
  | { name: 'plan'; id: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const plan = /^\/plan\/([\w-]{1,64})$/.exec(path);
  if (plan?.[1]) return { name: 'plan', id: plan[1] };
  const create = /^\/new(?:\/(wedding|birthday|community))?$/.exec(path);
  if (create) return { name: 'new', eventType: (create[1] as 'wedding' | 'birthday' | 'community' | undefined) ?? null };
  return { name: 'home' };
}

export function navigate(path: string): void {
  if (window.location.hash !== `#${path}`) window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Today's date, refreshed when the tab regains focus after midnight. */
export function useToday(getToday: () => string): string {
  const [today, setToday] = useState(getToday);
  useEffect(() => {
    const refresh = () => setToday(getToday());
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [getToday]);
  return today;
}
