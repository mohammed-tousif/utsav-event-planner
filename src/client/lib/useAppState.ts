import { useCallback, useEffect, useState } from 'react';
import type { StatusResponse } from '../../shared/api';
import type { Plan } from '../../shared/schemas';
import { fetchStatus } from './api';
import { navigate, type Route } from './hooks';
import { loadPlan, savePlan, type LoadResult, type SaveResult } from './storage';

/** The server's AI status, fetched once. Null while loading or if the server cannot be reached. */
export function useServerStatus(): StatusResponse | null {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal)
      .then(setStatus)
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, []);
  return status;
}

const LOAD_ERRORS: Record<Exclude<LoadResult, { ok: true }>['reason'], string> = {
  corrupt: 'This saved plan could not be read. It may have been edited outside Utsav.',
  unavailable: 'This browser is blocking storage, so saved plans cannot be opened.',
  missing: 'That plan is not saved in this browser.',
};

/**
 * The plan named in the URL, plus saving. localStorage is synchronous, so the
 * plan is loaded during render rather than in an effect.
 */
export function useRoutePlan(route: Route) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveResult>({ ok: true });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (route.name === 'plan' && loadedFor !== route.id && plan?.id !== route.id) {
    setLoadedFor(route.id);
    const result = loadPlan(route.id);
    setPlan(result.ok ? result.plan : null);
    setLoadError(result.ok ? null : LOAD_ERRORS[result.reason]);
  }

  const updatePlan = useCallback((next: Plan) => {
    setPlan(next);
    setLoadedFor(next.id);
    setSaveState(savePlan(next));
  }, []);

  const openPlan = useCallback(
    (next: Plan) => {
      updatePlan(next);
      navigate(`/plan/${next.id}`);
    },
    [updatePlan],
  );

  return { plan, loadError, saveState, updatePlan, openPlan };
}

const PAGE_TITLES: Record<string, string> = { home: 'Utsav — event planner', new: 'Plan an event — Utsav' };

/** Keeps the browser tab title in step with the screen. */
export function useDocumentTitle(route: Route, plan: Plan | null): void {
  useEffect(() => {
    document.title = route.name === 'plan' && plan ? `${plan.input.title || 'Your plan'} — Utsav` : (PAGE_TITLES[route.name] ?? 'Utsav');
  }, [route.name, plan]);
}
