import { useState } from 'react';
import type { Plan } from '../../shared/schemas';
import type { SaveResult } from '../lib/storage';
import { BudgetBand } from './BudgetBand';
import { BudgetTab } from './BudgetTab';
import { HistoryTab } from './HistoryTab';
import { IdeasTab } from './IdeasTab';
import { Notice } from './Notice';
import type { TabKey } from './plan/describe';
import { ExportPanel } from './plan/ExportPanel';
import { PlanHeader } from './plan/PlanHeader';
import { usePlanEditing } from './plan/usePlanEditing';
import { PrintPlan } from './PrintPlan';
import { RevisePanel } from './RevisePanel';
import { Tabs, type TabDef } from './Tabs';
import { TimelineTab } from './TimelineTab';
import { VendorsTab } from './VendorsTab';

interface PlanViewProps {
  plan: Plan;
  today: string;
  saveState: SaveResult;
  onChange: (plan: Plan) => void;
}

function tabsFor(plan: Plan): TabDef<TabKey>[] {
  return [
    { key: 'budget', label: 'Budget' },
    { key: 'timeline', label: 'Timeline', badge: `${plan.timeline.tasks.filter((t) => !t.done).length}` },
    { key: 'vendors', label: 'Vendors' },
    { key: 'ideas', label: 'Ideas' },
    { key: 'history', label: 'Changes', badge: plan.revisions.length ? String(plan.revisions.length) : undefined },
  ];
}

function focusChangeRequest() {
  const field = document.getElementById('revise-request');
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  field?.focus({ preventScroll: true });
}

function SaveWarning({ saveState }: { saveState: SaveResult }) {
  if (saveState.ok) return null;
  return (
    <Notice tone="warn" title="Not saved in this browser">
      {saveState.reason === 'quota' ? 'Browser storage is full.' : 'Browser storage is blocked.'} Download the plan file to keep it.
    </Notice>
  );
}

function Assumptions({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="assumptions">
      <summary>Assumptions the plan makes</summary>
      <ul>
        {items.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </details>
  );
}

/** The plan workspace: header, budget band, the five tabs, the change panel and exports. */
export function PlanView({ plan, today, saveState, onChange }: PlanViewProps) {
  const editing = usePlanEditing(plan, today, onChange);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const { diff } = editing;

  return (
    <>
      <div className="page plan no-print">
        <PlanHeader
          plan={plan}
          today={today}
          onShowExchange={() => {
            setExchangeOpen(true);
            editing.setTab('history');
          }}
        />
        <BudgetBand key={`${plan.id}-${editing.diffKey}`} budget={plan.budget} diff={diff} focusKey={focusKey} />
        <p className="jump-to-change">
          <button type="button" className="link" onClick={focusChangeRequest}>
            Change the plan
          </button>
        </p>
        <SaveWarning saveState={saveState} />

        <div className="plan-layout">
          <div className="plan-main">
            <Tabs tabs={tabsFor(plan)} active={editing.tab} onChange={editing.setTab} label="Plan sections">
              {(key, panel) => (
                <div {...panel} className="tab-panel">
                  {key === 'budget' && (
                    <BudgetTab
                      budget={plan.budget}
                      guestCount={plan.input.guestCount}
                      diff={diff}
                      focusKey={focusKey}
                      onFocusKey={setFocusKey}
                      onToggleLock={editing.toggleLock}
                      onContingency={(value) => editing.manual({ contingencyPct: value })}
                      busy={editing.busy}
                    />
                  )}
                  {key === 'timeline' && <TimelineTab plan={plan} today={today} onToggleTask={editing.toggleTask} />}
                  {key === 'vendors' && <VendorsTab plan={plan} today={today} onUpdate={editing.updateVendor} />}
                  {key === 'ideas' && <IdeasTab plan={plan} changed={Boolean(diff?.regenerated.includes('ideas'))} />}
                  {key === 'history' && <HistoryTab plan={plan} exchangeOpen={exchangeOpen} />}
                </div>
              )}
            </Tabs>
            <Assumptions items={plan.assumptions} />
          </div>

          <aside className="plan-side">
            <RevisePanel
              plan={plan}
              busy={editing.busy}
              error={editing.error}
              notice={editing.notice}
              onRevise={(r) => void editing.revise(r)}
              onCancel={editing.cancel}
              onQuickEdit={editing.manual}
            />
            <ExportPanel plan={plan} saved={saveState.ok} />
          </aside>
        </div>
      </div>
      <PrintPlan plan={plan} />
    </>
  );
}
