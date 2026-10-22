import { useState } from 'react';
import { CONTINGENCY_MAX } from '../../shared/budget';
import { formatMoney, formatMoneyDelta } from '../../shared/money';
import type { Budget, PlanDiff } from '../../shared/schemas';
import type { CategoryKey } from '../../shared/constants';
import { pct } from '../lib/format';
import { Notice } from './Notice';

interface BudgetTabProps {
  budget: Budget;
  guestCount: number;
  diff: PlanDiff | null;
  focusKey: string | null;
  onFocusKey: (key: string | null) => void;
  onToggleLock: (key: CategoryKey, locked: boolean) => void;
  onContingency: (pct: number) => void;
  busy: boolean;
}

export function BudgetTab({ budget, guestCount, diff, focusKey, onFocusKey, onToggleLock, onContingency, busy }: BudgetTabProps) {
  const [contingency, setContingency] = useState(String(budget.contingencyPct));
  const allocated = budget.lines.reduce((sum, l) => sum + l.amount, 0);
  const before = (key: string) => diff?.lines.find((l) => l.key === key)?.before;

  return (
    <div className="budget-tab">
      {budget.warnings.filter((w) => w.code !== 'no_benchmark').length > 0 && (
        <div className="stack-s">
          {budget.warnings
            .filter((w) => w.code !== 'no_benchmark')
            .map((w) => (
              <Notice key={w.code} tone={w.level === 'warn' ? 'warn' : w.level === 'error' ? 'error' : 'info'}>
                {w.message}
              </Notice>
            ))}
        </div>
      )}

      <table className="budget-table">
        <caption className="visually-hidden">Budget by category, in {budget.currency}. Amounts are estimates.</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Share
            </th>
            <th scope="col">
              <span className="visually-hidden">Keep unchanged</span>
              <span aria-hidden="true">Keep</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {budget.lines.map((line) => {
            const prior = before(line.key);
            const delta = prior === undefined ? 0 : line.amount - prior;
            return (
              <tr
                key={line.key}
                data-changed={delta !== 0 || undefined}
                data-focus={focusKey === line.key || undefined}
                onMouseEnter={() => onFocusKey(line.key)}
                onMouseLeave={() => onFocusKey(null)}
              >
                <th scope="row">
                  <span className="line-label">{line.label}</span>
                  {line.rationale && <span className="line-why">{line.rationale}</span>}
                </th>
                <td className="num">
                  <span className="amount">{formatMoney(line.amount, budget.currency)}</span>
                  {delta !== 0 && (
                    <span className="delta" data-direction={delta > 0 ? 'up' : 'down'}>
                      {formatMoneyDelta(delta, budget.currency)}
                    </span>
                  )}
                </td>
                <td className="num muted">{pct(line.amount, budget.total)}</td>
                <td>
                  <label className="lock">
                    <input
                      type="checkbox"
                      checked={line.locked}
                      disabled={busy}
                      onChange={(event) => onToggleLock(line.key, event.target.checked)}
                      aria-label={`Keep ${line.label} at ${formatMoney(line.amount, budget.currency)} when the plan changes`}
                    />
                    <span aria-hidden="true">{line.locked ? 'Kept' : ''}</span>
                  </label>
                </td>
              </tr>
            );
          })}
          <tr className="contingency-row" data-focus={focusKey === 'contingency' || undefined}>
            <th scope="row">
              <span className="line-label">Contingency</span>
              <span className="line-why">Held back for price rises, extra guests and last-minute fixes.</span>
            </th>
            <td className="num">
              <span className="amount">{formatMoney(budget.contingency, budget.currency)}</span>
              {diff && diff.contingencyAfter !== diff.contingencyBefore && (
                <span className="delta" data-direction={diff.contingencyAfter > diff.contingencyBefore ? 'up' : 'down'}>
                  {formatMoneyDelta(diff.contingencyAfter - diff.contingencyBefore, budget.currency)}
                </span>
              )}
            </td>
            <td className="num muted">{pct(budget.contingency, budget.total)}</td>
            <td />
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num">
              <span className="amount">{formatMoney(allocated + budget.contingency, budget.currency)}</span>
            </td>
            <td className="num muted">100%</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="table-note">
        {formatMoney(budget.perGuest, budget.currency)} per guest for {guestCount.toLocaleString('en-IN')} guests. Every amount is
        calculated by the app so the total always matches; categories marked “Kept” stay fixed when you change the plan.
      </p>

      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(contingency);
          if (Number.isFinite(value)) onContingency(value);
        }}
      >
        <label htmlFor="contingency">Contingency (% of total)</label>
        <input
          id="contingency"
          className="short"
          inputMode="decimal"
          value={contingency}
          onChange={(e) => setContingency(e.target.value.replace(/[^\d.]/g, ''))}
          aria-describedby="contingency-hint"
        />
        <button type="submit" className="button quiet small" disabled={busy || Number(contingency) === budget.contingencyPct}>
          Update
        </button>
        <span id="contingency-hint" className="field-hint">
          0 to {CONTINGENCY_MAX}%. Recalculated in the app, no AI used.
        </span>
      </form>

      {budget.tradeoffs.length > 0 && (
        <section className="tradeoffs" aria-labelledby="tradeoffs-title">
          <h3 id="tradeoffs-title">Trade-offs to consider</h3>
          <ul>
            {budget.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
