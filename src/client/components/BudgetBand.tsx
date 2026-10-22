import { useEffect, useState } from 'react';
import { formatMoney } from '../../shared/money';
import type { Budget, PlanDiff } from '../../shared/schemas';
import { pct } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';

interface BudgetBandProps {
  budget: Budget;
  diff: PlanDiff | null;
  focusKey: string | null;
}

interface Segment {
  key: string;
  label: string;
  amount: number;
  before: number;
  contingency?: boolean;
}

/**
 * The plan's signature element: one band showing how the whole budget is
 * split. When a plan first opens, the segments grow in once; after a change
 * the band starts from the old split and moves to the new one, so the user
 * sees exactly where money went. The parent remounts it (via `key`) for each
 * change. The category table is the exact, accessible view of the same data.
 */
export function BudgetBand({ budget, diff, focusKey }: BudgetBandProps) {
  const reduced = useReducedMotion();
  const [settled, setSettled] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [reduced]);

  const segments: Segment[] = [
    ...budget.lines
      .filter((line) => line.amount > 0 || (diff?.lines.find((l) => l.key === line.key)?.before ?? 0) > 0)
      .map((line) => ({
        key: line.key,
        label: line.label,
        amount: line.amount,
        before: diff?.lines.find((l) => l.key === line.key)?.before ?? line.amount,
      })),
    {
      key: 'contingency',
      label: 'Contingency',
      amount: budget.contingency,
      before: diff?.contingencyBefore ?? budget.contingency,
      contingency: true,
    },
  ];
  const scale = Math.max(budget.total, diff?.totalBefore ?? 0, 1);
  const showAfter = settled || reduced;

  return (
    <figure className="band" aria-label="Budget split">
      <div className="band-track" aria-hidden="true" data-intro={!diff || undefined}>
        {segments.map((segment, index) => {
          const start = diff ? segment.before : 0;
          const value = showAfter ? segment.amount : start;
          return (
            <span
              key={segment.key}
              className="band-seg"
              data-contingency={segment.contingency || undefined}
              data-changed={(diff && segment.before !== segment.amount) || undefined}
              data-focus={focusKey === segment.key || undefined}
              style={{
                width: `${(value / scale) * 100}%`,
                transitionDelay: !diff && !reduced ? `${index * 45}ms` : undefined,
              }}
            />
          );
        })}
      </div>
      <figcaption className="band-caption">
        <BandReadout budget={budget} segments={segments} focusKey={focusKey} />
      </figcaption>
    </figure>
  );
}

function BandReadout({ budget, segments, focusKey }: { budget: Budget; segments: Segment[]; focusKey: string | null }) {
  const focused = segments.find((s) => s.key === focusKey);
  if (focused) {
    return (
      <span className="band-readout">
        <strong>{focused.label}</strong> {formatMoney(focused.amount, budget.currency)}, {pct(focused.amount, budget.total)} of the
        budget
      </span>
    );
  }
  return (
    <span className="band-readout">
      <strong>{formatMoney(budget.total - budget.contingency, budget.currency)}</strong> allocated across {segments.length - 1}{' '}
      categories, with <strong>{formatMoney(budget.contingency, budget.currency)}</strong> held back for surprises
    </span>
  );
}
