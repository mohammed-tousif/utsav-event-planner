import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_TYPE_LABELS, type CategoryKey } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import { applyManualChange, RevisionError, type ManualChange } from '../../shared/revision';
import type { Plan, PlanDiff, Vendor } from '../../shared/schemas';
import { ClientApiError, revisePlan } from '../lib/api';
import { downloadFile, fileSlug, planToIcs } from '../lib/export';
import { daysToGoLabel, formatLongDate } from '../lib/format';
import type { SaveResult } from '../lib/storage';
import { planTitle } from '../lib/storage';
import { BudgetBand } from './BudgetBand';
import { BudgetTab } from './BudgetTab';
import { HistoryTab } from './HistoryTab';
import { IdeasTab } from './IdeasTab';
import { Notice } from './Notice';
import { PrintPlan } from './PrintPlan';
import { RevisePanel } from './RevisePanel';
import { Tabs, type TabDef } from './Tabs';
import { TimelineTab } from './TimelineTab';
import { VendorsTab } from './VendorsTab';

type TabKey = 'budget' | 'timeline' | 'vendors' | 'ideas' | 'history';

interface PlanViewProps {
  plan: Plan;
  today: string;
  saveState: SaveResult;
  onChange: (plan: Plan) => void;
}

function describeDiff(diff: PlanDiff, plan: Plan): string {
  const currency = plan.input.currency;
  const parts: string[] = [];
  if (diff.totalBefore !== diff.totalAfter) parts.push(`Total ${formatMoney(diff.totalBefore, currency)} to ${formatMoney(diff.totalAfter, currency)}.`);
  if (diff.guestsBefore !== diff.guestsAfter) parts.push(`Guests ${diff.guestsBefore} to ${diff.guestsAfter}.`);
  if (diff.dateBefore !== diff.dateAfter) parts.push(`Date moved to ${formatLongDate(diff.dateAfter)}.`);
  const moved = diff.lines.filter((l) => l.before !== l.after).length;
  if (moved) parts.push(`${moved} budget categor${moved === 1 ? 'y' : 'ies'} changed.`);
  if (diff.regenerated.length) parts.push(`Rewrote ${diff.regenerated.join(', ')}.`);
  return parts.join(' ') || 'Updated.';
}

export function PlanView({ plan, today, saveState, onChange }: PlanViewProps) {
  const [tab, setTab] = useState<TabKey>('budget');
  const [diff, setDiff] = useState<PlanDiff | null>(null);
  const [diffKey, setDiffKey] = useState(0);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pending, setPending] = useState<AbortController | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [notice, setNotice] = useState<{ summary: string; changes: string[] } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [plan.id]);

  const showDiff = useCallback((next: PlanDiff) => {
    setDiff(next);
    setDiffKey((k) => k + 1);
  }, []);

  async function revise(request: string) {
    const controller = new AbortController();
    setPending(controller);
    setError(null);
    setNotice(null);
    try {
      const response = await revisePlan(plan, request, controller.signal);
      onChange(response.plan);
      showDiff(response.diff);
      const latest = response.plan.revisions[0];
      setNotice({
        summary: `${latest?.understood ? `${latest.understood} ` : ''}${describeDiff(response.diff, response.plan)}`,
        changes: latest?.changes ?? [],
      });
      if (response.diff.regenerated.length && !response.diff.lines.some((l) => l.before !== l.after)) {
        const first = response.diff.regenerated[0];
        setTab(first === 'tasks' || first === 'schedule' ? 'timeline' : first === 'vendors' ? 'vendors' : 'ideas');
      } else setTab('budget');
    } catch (err) {
      if (err instanceof ClientApiError && err.code === 'aborted') return;
      setError(err instanceof ClientApiError ? err : new ClientApiError('internal', 'Something went wrong. Try again.'));
    } finally {
      setPending(null);
    }
  }

  function manual(change: ManualChange) {
    setError(null);
    try {
      const result = applyManualChange(plan, change, today);
      onChange(result.plan);
      showDiff(result.diff);
      setNotice({ summary: `${describeDiff(result.diff, result.plan)} Recalculated in the app, no AI used.`, changes: [] });
    } catch (err) {
      const message = err instanceof RevisionError || err instanceof Error ? err.message : 'That change could not be applied.';
      setError(new ClientApiError(err instanceof RevisionError && err.code === 'infeasible' ? 'budget_infeasible' : 'invalid_input', message));
      setNotice(null);
    }
  }

  function toggleLock(key: CategoryKey, locked: boolean) {
    manual({ lock: { key, locked } });
  }

  function touch(next: Partial<Plan>) {
    onChange({ ...plan, ...next, updatedAt: new Date().toISOString() });
  }

  function toggleTask(id: string, done: boolean) {
    touch({ timeline: { ...plan.timeline, tasks: plan.timeline.tasks.map((t) => (t.id === id ? { ...t, done } : t)) } });
  }

  function updateVendor(id: string, patch: Partial<Pick<Vendor, 'status' | 'quote' | 'notes'>>) {
    touch({ vendors: plan.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  }

  const tabs: TabDef<TabKey>[] = [
    { key: 'budget', label: 'Budget' },
    { key: 'timeline', label: 'Timeline', badge: `${plan.timeline.tasks.filter((t) => !t.done).length}` },
    { key: 'vendors', label: 'Vendors' },
    { key: 'ideas', label: 'Ideas' },
    { key: 'history', label: 'Changes', badge: plan.revisions.length ? String(plan.revisions.length) : undefined },
  ];
  const sample = plan.meta.source === 'sample';
  const days = daysToGoLabel(plan.input.eventDate, today);

  return (
    <>
      <div className="page plan no-print">
        <header className="plan-head">
          <p className="plan-kind">{EVENT_TYPE_LABELS[plan.input.eventType]}</p>
          <h1 ref={headingRef} tabIndex={-1} className="display plan-title">
            {planTitle(plan)}
          </h1>
          <dl className="plan-facts">
            <div>
              <dt>Date</dt>
              <dd>
                {formatLongDate(plan.input.eventDate)} <span className="muted">({days.toLowerCase()})</span>
              </dd>
            </div>
            <div>
              <dt>Guests</dt>
              <dd className="tabular">{plan.input.guestCount.toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd className="tabular">{formatMoney(plan.budget.total, plan.input.currency)}</dd>
            </div>
            <div>
              <dt>Where</dt>
              <dd>{plan.input.city}</dd>
            </div>
          </dl>
          <p className="provenance" data-sample={sample || undefined}>
            {sample
              ? 'Sample data: this plan was filled with fixed placeholder content, not AI.'
              : `Drafted by ${plan.meta.provider} (${plan.meta.model}). Amounts are calculated by the app. All costs are estimates.`}
          </p>
          {plan.summary && <p className="plan-summary">{plan.summary}</p>}
        </header>

        <BudgetBand key={`${plan.id}-${diffKey}`} budget={plan.budget} diff={diff} focusKey={focusKey} />

        <p className="jump-to-change">
          <a href="#revise-title">Change the plan</a>
        </p>

        {!saveState.ok && (
          <Notice tone="warn" title="Not saved in this browser">
            {saveState.reason === 'quota' ? 'Browser storage is full.' : 'Browser storage is blocked.'} Download the plan file to keep it.
          </Notice>
        )}

        <div className="plan-layout">
          <div className="plan-main">
            <Tabs tabs={tabs} active={tab} onChange={setTab} label="Plan sections">
              {(key, panel) => (
                <div {...panel} className="tab-panel">
                  {key === 'budget' && (
                    <BudgetTab
                      budget={plan.budget}
                      guestCount={plan.input.guestCount}
                      diff={diff}
                      focusKey={focusKey}
                      onFocusKey={setFocusKey}
                      onToggleLock={toggleLock}
                      onContingency={(value) => manual({ contingencyPct: value })}
                      busy={Boolean(pending)}
                    />
                  )}
                  {key === 'timeline' && <TimelineTab plan={plan} today={today} onToggleTask={toggleTask} />}
                  {key === 'vendors' && <VendorsTab plan={plan} today={today} onUpdate={updateVendor} />}
                  {key === 'ideas' && <IdeasTab plan={plan} changed={Boolean(diff?.regenerated.includes('ideas'))} />}
                  {key === 'history' && <HistoryTab plan={plan} />}
                </div>
              )}
            </Tabs>
            {plan.assumptions.length > 0 && (
              <details className="assumptions">
                <summary>Assumptions the plan makes</summary>
                <ul>
                  {plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <aside className="plan-side">
            <RevisePanel
              plan={plan}
              busy={Boolean(pending)}
              error={error}
              notice={notice}
              onRevise={(r) => void revise(r)}
              onCancel={() => pending?.abort()}
              onQuickEdit={(c) => manual(c)}
            />
            <section className="export" aria-labelledby="export-title">
              <h2 id="export-title">Save and share</h2>
              <p className="muted">{saveState.ok ? 'Saved automatically in this browser.' : 'Not saved in this browser.'}</p>
              <div className="export-actions">
                <button type="button" className="button quiet" onClick={() => window.print()}>
                  Print or save as PDF
                </button>
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => downloadFile(`${fileSlug(plan)}.json`, JSON.stringify(plan, null, 2), 'application/json')}
                >
                  Download plan file
                </button>
                <button type="button" className="button quiet" onClick={() => downloadFile(`${fileSlug(plan)}.ics`, planToIcs(plan), 'text/calendar')}>
                  Add tasks to a calendar
                </button>
              </div>
              <p className="field-hint">The plan file can be imported on the home page, in any browser.</p>
            </section>
          </aside>
        </div>
      </div>
      <PrintPlan plan={plan} />
    </>
  );
}
