import type { Plan } from '../shared/schemas';
import { Home } from './components/Home';
import { Intake } from './components/Intake';
import { SiteFooter, SiteHeader } from './components/layout/SiteChrome';
import { Notice } from './components/Notice';
import { PlanView } from './components/PlanView';
import { clientToday } from './lib/api';
import { useRoute, useToday } from './lib/hooks';
import { useDocumentTitle, useRoutePlan, useServerStatus } from './lib/useAppState';

function PlanNotFound({ message }: { message: string }) {
  return (
    <div className="page narrow">
      <Notice tone="error" title="Plan not found">
        {message}
      </Notice>
      <p>
        <a className="button" href="#/">
          Go to your plans
        </a>
      </p>
    </div>
  );
}

/** The whole app: routes between the home page, the intake form and a plan. */
export function App() {
  const route = useRoute();
  const today = useToday(clientToday);
  const status = useServerStatus();
  const { plan, loadError, saveState, updatePlan, openPlan } = useRoutePlan(route);
  useDocumentTitle(route, plan);

  const routePlan: Plan | null = route.name === 'plan' && plan?.id === route.id ? plan : null;

  return (
    <>
      <SiteHeader status={status} />
      <main id="main" tabIndex={-1}>
        {route.name === 'home' && <Home today={today} />}
        {route.name === 'new' && <Intake initialType={route.eventType} today={today} status={status} onPlan={openPlan} />}
        {routePlan && <PlanView plan={routePlan} today={today} onChange={updatePlan} saveState={saveState} />}
        {route.name === 'plan' && !routePlan && loadError && <PlanNotFound message={loadError} />}
      </main>
      <SiteFooter />
    </>
  );
}
