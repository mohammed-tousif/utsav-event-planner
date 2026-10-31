import { useState } from 'react';
import type { CategoryKey } from '../../../shared/constants';
import { applyManualChange, RevisionError, type ManualChange } from '../../../shared/revision';
import type { Plan, PlanDiff, Vendor } from '../../../shared/schemas';
import { ClientApiError, revisePlan } from '../../lib/api';
import { describeDiff, tabForDiff, type TabKey } from './describe';

export interface ChangeNotice {
  summary: string;
  changes: string[];
}

function asClientError(err: unknown): ClientApiError {
  return err instanceof ClientApiError ? err : new ClientApiError('internal', 'Something went wrong. Try again.');
}

function manualChangeError(err: unknown): ClientApiError {
  const message = err instanceof Error ? err.message : 'That change could not be applied.';
  const infeasible = err instanceof RevisionError && err.code === 'infeasible';
  return new ClientApiError(infeasible ? 'budget_infeasible' : 'invalid_input', message);
}

/**
 * Everything that changes a plan from the plan screen: AI revisions, direct
 * edits recalculated in the browser, and progress such as ticking off tasks.
 */
export function usePlanEditing(plan: Plan, today: string, onChange: (plan: Plan) => void) {
  const [tab, setTab] = useState<TabKey>('budget');
  const [diff, setDiff] = useState<PlanDiff | null>(null);
  /** Bumped on every change so the budget band replays its animation. */
  const [diffKey, setDiffKey] = useState(0);
  const [pending, setPending] = useState<AbortController | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [notice, setNotice] = useState<ChangeNotice | null>(null);

  function applied(next: Plan, nextDiff: PlanDiff, summary: ChangeNotice) {
    onChange(next);
    setDiff(nextDiff);
    setDiffKey((k) => k + 1);
    setNotice(summary);
  }

  async function revise(request: string) {
    const controller = new AbortController();
    setPending(controller);
    setError(null);
    setNotice(null);
    try {
      const response = await revisePlan(plan, request, controller.signal);
      const latest = response.plan.revisions[0];
      const understood = latest?.understood ? `${latest.understood} ` : '';
      applied(response.plan, response.diff, {
        summary: `${understood}${describeDiff(response.diff, response.plan)}`,
        changes: latest?.changes ?? [],
      });
      setTab(tabForDiff(response.diff));
    } catch (err) {
      if (!(err instanceof ClientApiError && err.code === 'aborted')) setError(asClientError(err));
    } finally {
      setPending(null);
    }
  }

  function manual(change: ManualChange) {
    setError(null);
    try {
      const result = applyManualChange(plan, change, today);
      applied(result.plan, result.diff, {
        summary: `${describeDiff(result.diff, result.plan)} Recalculated in the app, no AI used.`,
        changes: [],
      });
    } catch (err) {
      setError(manualChangeError(err));
      setNotice(null);
    }
  }

  /** Progress edits (ticks, quotes, notes) that do not change any amounts or dates. */
  function touch(next: Partial<Plan>) {
    onChange({ ...plan, ...next, updatedAt: new Date().toISOString() });
  }

  return {
    tab,
    setTab,
    diff,
    diffKey,
    busy: Boolean(pending),
    error,
    notice,
    revise,
    cancel: () => pending?.abort(),
    manual,
    toggleLock: (key: CategoryKey, locked: boolean) => manual({ lock: { key, locked } }),
    toggleTask: (id: string, done: boolean) =>
      touch({ timeline: { ...plan.timeline, tasks: plan.timeline.tasks.map((t) => (t.id === id ? { ...t, done } : t)) } }),
    updateVendor: (id: string, patch: Partial<Pick<Vendor, 'status' | 'quote' | 'notes'>>) =>
      touch({ vendors: plan.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)) }),
  };
}
