import { useCallback, useEffect, useState } from 'react';
import type { StatusResponse } from '../shared/api';
import type { Plan } from '../shared/schemas';
import { clientToday, fetchStatus } from './lib/api';
import { navigate, useRoute, useToday } from './lib/hooks';
import { loadPlan, savePlan, type SaveResult } from './lib/storage';
import { Home } from './components/Home';
import { Intake } from './components/Intake';
import { PlanView } from './components/PlanView';
import { Notice } from './components/Notice';

export function App() {
  const route = useRoute();
  const today = useToday(clientToday);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveResult>({ ok: true });

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal)
      .then(setStatus)
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, []);

  // Load the plan named in the URL (localStorage is synchronous, so this
  // happens during render rather than in an effect).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (route.name === 'plan' && loadedFor !== route.id && plan?.id !== route.id) {
    setLoadedFor(route.id);
    const result = loadPlan(route.id);
    if (result.ok) {
      setPlan(result.plan);
      setLoadError(null);
    } else {
      setPlan(null);
      setLoadError(
        result.reason === 'corrupt'
          ? 'This saved plan could not be read. It may have been edited outside Utsav.'
          : result.reason === 'unavailable'
            ? 'This browser is blocking storage, so saved plans cannot be opened.'
            : 'That plan is not saved in this browser.',
      );
    }
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

  useEffect(() => {
    const titles: Record<string, string> = { home: 'Utsav — event planner', new: 'Plan an event — Utsav' };
    document.title = route.name === 'plan' && plan ? `${plan.input.title || 'Your plan'} — Utsav` : (titles[route.name] ?? 'Utsav');
  }, [route.name, plan]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header no-print">
        <a className="wordmark" href="#/" aria-label="Utsav home">
          <svg aria-hidden="true" viewBox="0 0 32 32" width="28" height="28">
            <rect width="32" height="32" rx="8" className="wordmark-tile" />
            <g className="wordmark-petals">
              <circle cx="16" cy="9" r="3.2" />
              <circle cx="9.5" cy="13" r="2.6" />
              <circle cx="22.5" cy="13" r="2.6" />
              <circle cx="12" cy="20" r="2.2" />
              <circle cx="20" cy="20" r="2.2" />
              <circle cx="16" cy="25" r="1.8" />
            </g>
          </svg>
          <span>Utsav</span>
        </a>
        {status && (
          <p className="ai-status" data-sample={status.ai.sampleData || undefined}>
            {status.ai.sampleData
              ? 'Sample data mode: no AI connected'
              : status.ai.configured
                ? 'Plans drafted by Google Gemini'
                : 'AI not configured on this server'}
          </p>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {route.name === 'home' && <Home today={today} />}
        {route.name === 'new' && <Intake initialType={route.eventType} today={today} status={status} onPlan={openPlan} />}
        {route.name === 'plan' &&
          (plan && plan.id === route.id ? (
            <PlanView plan={plan} today={today} onChange={updatePlan} saveState={saveState} />
          ) : loadError ? (
            <div className="page narrow">
              <Notice tone="error" title="Plan not found">
                {loadError}
              </Notice>
              <p>
                <a className="button" href="#/">
                  Go to your plans
                </a>
              </p>
            </div>
          ) : null)}
      </main>
      <footer className="site-footer no-print">
        <p>
          Costs and lead times are AI-assisted estimates, not quotes. Utsav does not check real vendor availability.
          Plans are saved only in this browser.
        </p>
      </footer>
    </>
  );
}
