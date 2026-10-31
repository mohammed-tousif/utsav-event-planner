import { useEffect, useRef, type ReactNode } from 'react';
import { EVENT_TYPE_LABELS } from '../../../shared/constants';
import { formatMoney } from '../../../shared/money';
import type { Plan } from '../../../shared/schemas';
import { daysToGoLabel, formatLongDate } from '../../lib/format';
import { planTitle } from '../../lib/storage';

interface PlanHeaderProps {
  plan: Plan;
  today: string;
  onShowExchange: () => void;
}

function Provenance({ plan, onShowExchange }: Omit<PlanHeaderProps, 'today'>) {
  const sample = plan.meta.source === 'sample';
  return (
    <p className="provenance" data-sample={sample || undefined}>
      {sample
        ? 'Sample data: this plan was filled with fixed placeholder content, not AI.'
        : `Drafted by ${plan.meta.provider} (${plan.meta.model}). Amounts are calculated by the app. All costs are estimates.`}{' '}
      {plan.meta.exchange && (
        <button type="button" className="link" onClick={onShowExchange}>
          See the prompt and reply
        </button>
      )}
    </p>
  );
}

/** Title, key facts, who drafted the plan, and its summary. Focused when a plan opens. */
export function PlanHeader({ plan, today, onShowExchange }: PlanHeaderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [plan.id]);

  const facts: [string, ReactNode, string?][] = [
    [
      'Date',
      <>
        {formatLongDate(plan.input.eventDate)} <span className="muted">({daysToGoLabel(plan.input.eventDate, today).toLowerCase()})</span>
      </>,
    ],
    ['Guests', plan.input.guestCount.toLocaleString('en-IN'), 'tabular'],
    ['Budget', formatMoney(plan.budget.total, plan.input.currency), 'tabular'],
    ['Where', plan.input.city],
  ];

  return (
    <header className="plan-head">
      <p className="plan-kind">{EVENT_TYPE_LABELS[plan.input.eventType]}</p>
      <h1 ref={headingRef} tabIndex={-1} className="display plan-title">
        {planTitle(plan)}
      </h1>
      <dl className="plan-facts">
        {facts.map(([term, value, className]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd className={className}>{value}</dd>
          </div>
        ))}
      </dl>
      <Provenance plan={plan} onShowExchange={onShowExchange} />
      {plan.summary && <p className="plan-summary">{plan.summary}</p>}
    </header>
  );
}
