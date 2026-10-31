import { useState } from 'react';
import { CONTINGENCY_MAX } from '../../shared/budget';
import type { CategoryKey } from '../../shared/constants';
import { formatMoney, formatMoneyDelta } from '../../shared/money';
import type { Budget, BudgetLine, BudgetWarning, PlanDiff } from '../../shared/schemas';
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

const WARNING_TONE: Record<BudgetWarning['level'], 'warn' | 'error' | 'info'> = { warn: 'warn', error: 'error', info: 'info' };

function BudgetWarnings({ warnings }: { warnings: BudgetWarning[] }) {
  // The "no INR benchmark" note is general information, not a warning about this plan.
  const shown = warnings.filter((w) => w.code !== 'no_benchmark');
  if (shown.length === 0) return null;
  return (
    <div className="stack-s">
      {shown.map((w) => (
        <Notice key={w.code} tone={WARNING_TONE[w.level]}>
          {w.message}
        </Notice>
      ))}
    </div>
  );
}

function Delta({ amount, currency }: { amount: number; currency: Budget['currency'] }) {
  if (amount === 0) return null;
  return (
    <span className="delta" data-direction={amount > 0 ? 'up' : 'down'}>
      {formatMoneyDelta(amount, currency)}
    </span>
  );
}

interface BudgetRowProps {
  line: BudgetLine;
  budget: Budget;
  delta: number;
  focused: boolean;
  busy: boolean;
  onFocusKey: BudgetTabProps['onFocusKey'];
  onToggleLock: BudgetTabProps['onToggleLock'];
}

function BudgetRow({ line, budget, delta, focused, busy, onFocusKey, onToggleLock }: BudgetRowProps) {
  const amount = formatMoney(line.amount, budget.currency);
  return (
    <tr
      data-changed={delta !== 0 || undefined}
      data-focus={focused || undefined}
      onMouseEnter={() => onFocusKey(line.key)}
      onMouseLeave={() => onFocusKey(null)}
    >
      <th scope="row">
        <span className="line-label">{line.label}</span>
        {line.rationale && <span className="line-why">{line.rationale}</span>}
      </th>
      <td className="num">
        <span className="amount">{amount}</span>
        <Delta amount={delta} currency={budget.currency} />
      </td>
      <td className="num muted">{pct(line.amount, budget.total)}</td>
      <td>
        <label className="lock">
          <input
            type="checkbox"
            checked={line.locked}
            disabled={busy}
            onChange={(event) => onToggleLock(line.key, event.target.checked)}
            aria-label={`Keep ${line.label} at ${amount} when the plan changes`}
          />
          <span aria-hidden="true">{line.locked ? 'Kept' : ''}</span>
        </label>
      </td>
    </tr>
  );
}

function ContingencyRow({ budget, diff, focused }: { budget: Budget; diff: PlanDiff | null; focused: boolean }) {
  return (
    <tr className="contingency-row" data-focus={focused || undefined}>
      <th scope="row">
        <span className="line-label">Contingency</span>
        <span className="line-why">Held back for price rises, extra guests and last-minute fixes.</span>
      </th>
      <td className="num">
        <span className="amount">{formatMoney(budget.contingency, budget.currency)}</span>
        {diff && <Delta amount={diff.contingencyAfter - diff.contingencyBefore} currency={budget.currency} />}
      </td>
      <td className="num muted">{pct(budget.contingency, budget.total)}</td>
      <td />
    </tr>
  );
}

function ContingencyForm({ budget, busy, onContingency }: Pick<BudgetTabProps, 'budget' | 'busy' | 'onContingency'>) {
  const [value, setValue] = useState(String(budget.contingencyPct));
  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = Number(value);
        if (Number.isFinite(next)) onContingency(next);
      }}
    >
      <label htmlFor="contingency">Contingency (% of total)</label>
      <input
        id="contingency"
        className="short"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
        aria-describedby="contingency-hint"
      />
      <button type="submit" className="button quiet small" disabled={busy || Number(value) === budget.contingencyPct}>
        Update
      </button>
      <span id="contingency-hint" className="field-hint">
        0 to {CONTINGENCY_MAX}%. Recalculated in the app, no AI used.
      </span>
    </form>
  );
}

function Tradeoffs({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="tradeoffs" aria-labelledby="tradeoffs-title">
      <h3 id="tradeoffs-title">Trade-offs to consider</h3>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

/** Budget table with what moved in the last change, locks, contingency and trade-offs. */
export function BudgetTab({ budget, guestCount, diff, focusKey, onFocusKey, onToggleLock, onContingency, busy }: BudgetTabProps) {
  const allocated = budget.lines.reduce((sum, l) => sum + l.amount, 0);
  const deltaFor = (line: BudgetLine) => {
    const before = diff?.lines.find((l) => l.key === line.key)?.before;
    return before === undefined ? 0 : line.amount - before;
  };

  return (
    <div className="budget-tab">
      <BudgetWarnings warnings={budget.warnings} />
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
          {budget.lines.map((line) => (
            <BudgetRow
              key={line.key}
              line={line}
              budget={budget}
              delta={deltaFor(line)}
              focused={focusKey === line.key}
              busy={busy}
              onFocusKey={onFocusKey}
              onToggleLock={onToggleLock}
            />
          ))}
          <ContingencyRow budget={budget} diff={diff} focused={focusKey === 'contingency'} />
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
      <ContingencyForm budget={budget} busy={busy} onContingency={onContingency} />
      <Tradeoffs items={budget.tradeoffs} />
    </div>
  );
}
