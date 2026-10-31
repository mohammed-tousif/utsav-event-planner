import { formatMoney } from '../../../shared/money';
import type { Plan, PlanDiff } from '../../../shared/schemas';
import { formatLongDate } from '../../lib/format';

export type TabKey = 'budget' | 'timeline' | 'vendors' | 'ideas' | 'history';

/** One-sentence summary of what a change did, for the result notice. */
export function describeDiff(diff: PlanDiff, plan: Plan): string {
  const currency = plan.input.currency;
  const moved = diff.lines.filter((l) => l.before !== l.after).length;
  const parts = [
    diff.totalBefore !== diff.totalAfter &&
      `Total ${formatMoney(diff.totalBefore, currency)} to ${formatMoney(diff.totalAfter, currency)}.`,
    diff.guestsBefore !== diff.guestsAfter && `Guests ${diff.guestsBefore} to ${diff.guestsAfter}.`,
    diff.dateBefore !== diff.dateAfter && `Date moved to ${formatLongDate(diff.dateAfter)}.`,
    moved > 0 && `${moved} budget categor${moved === 1 ? 'y' : 'ies'} changed.`,
    diff.regenerated.length > 0 && `Rewrote ${diff.regenerated.join(', ')}.`,
  ].filter(Boolean);
  return parts.join(' ') || 'Updated.';
}

const TAB_FOR_SECTION: Record<PlanDiff['regenerated'][number], TabKey> = {
  tasks: 'timeline',
  schedule: 'timeline',
  vendors: 'vendors',
  ideas: 'ideas',
};

/** After a change, show the tab where something visibly moved: the budget unless only sections were rewritten. */
export function tabForDiff(diff: PlanDiff): TabKey {
  const budgetMoved = diff.lines.some((l) => l.before !== l.after);
  const first = diff.regenerated[0];
  return first && !budgetMoved ? TAB_FOR_SECTION[first] : 'budget';
}
