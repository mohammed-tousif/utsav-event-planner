import type { Plan, PlanDiff } from '../schemas';

/** Before/after summary of a change, used for the history and the budget band animation. */
export function diffPlans(before: Plan, after: Pick<Plan, 'input' | 'budget'>, regenerated: PlanDiff['regenerated']): PlanDiff {
  const beforeLines = new Map(before.budget.lines.map((l) => [l.key, l] as const));
  return {
    totalBefore: before.budget.total,
    totalAfter: after.budget.total,
    guestsBefore: before.input.guestCount,
    guestsAfter: after.input.guestCount,
    dateBefore: before.input.eventDate,
    dateAfter: after.input.eventDate,
    contingencyBefore: before.budget.contingency,
    contingencyAfter: after.budget.contingency,
    lines: after.budget.lines.map((line) => ({
      key: line.key,
      label: line.label,
      before: beforeLines.get(line.key)?.amount ?? 0,
      after: line.amount,
    })),
    regenerated,
    locked: after.budget.lines.filter((l) => l.locked).map((l) => l.key),
  };
}

function lockedKeys(plan: Plan): string {
  return plan.budget.lines
    .filter((l) => l.locked)
    .map((l) => l.key)
    .join();
}

/** True when a diff (plus any style change) actually changes something the user can see. */
export function diffHasChanges(plan: Plan, diff: PlanDiff, styleChanged: boolean): boolean {
  const budgetChanged =
    diff.totalBefore !== diff.totalAfter ||
    diff.contingencyBefore !== diff.contingencyAfter ||
    diff.lines.some((l) => l.before !== l.after);
  return (
    budgetChanged ||
    diff.locked.join() !== lockedKeys(plan) ||
    diff.regenerated.length > 0 ||
    diff.guestsBefore !== diff.guestsAfter ||
    diff.dateBefore !== diff.dateAfter ||
    styleChanged
  );
}
