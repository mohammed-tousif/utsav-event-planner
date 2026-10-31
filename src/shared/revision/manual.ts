import { MAX_BUDGET, MAX_GUESTS, type CategoryKey, type PriorityKey } from '../constants';
import { clampContingency, computeBudget, lockedAmounts } from '../budget';
import { isISODate } from '../dates';
import { formatMoney } from '../money';
import { newId, redateVendors, refreshIdeaFit } from '../plan';
import type { EventInput, Plan, RevisionEntry } from '../schemas';
import { checkEventDate, scheduleTasks, timelineWarnings } from '../timeline';
import { appendHistory, lineRationales, taskSeeds, type RevisionResult } from './apply';
import { diffPlans } from './diff';
import { RevisionError, withBudget, withDate } from './errors';

/** A direct edit made in the app. These are recalculated without any AI call. */
export interface ManualChange {
  totalBudget?: number;
  guestCount?: number;
  contingencyPct?: number;
  priorities?: PriorityKey[];
  eventDate?: string;
  lock?: { key: CategoryKey; locked: boolean };
}

type Amounts = Partial<Record<CategoryKey, number>>;

function editedTotal(input: EventInput, value: number | undefined, notes: string[]): number {
  if (value === undefined || value === input.totalBudget) return input.totalBudget;
  if (!Number.isFinite(value) || value < 1 || value > MAX_BUDGET) {
    throw new RevisionError('invalid_change', 'Enter a total budget greater than zero.');
  }
  notes.push(`Total budget: ${formatMoney(input.totalBudget, input.currency)} → ${formatMoney(value, input.currency)}.`);
  return Math.round(value);
}

function editedGuests(input: EventInput, value: number | undefined, notes: string[]): number {
  if (value === undefined || value === input.guestCount) return input.guestCount;
  if (!Number.isInteger(value) || value < 1 || value > MAX_GUESTS) {
    throw new RevisionError('invalid_change', `Guest count must be a whole number from 1 to ${MAX_GUESTS}.`);
  }
  notes.push(`Guests: ${input.guestCount} → ${value}.`);
  return value;
}

function editedPriorities(input: EventInput, value: PriorityKey[] | undefined, notes: string[]): PriorityKey[] {
  if (!value) return input.priorities;
  notes.push('Priorities updated.');
  return [...new Set(value)].slice(0, 3);
}

function editedDate(input: EventInput, value: string | undefined, today: string, notes: string[]): string {
  if (!value || value === input.eventDate) return input.eventDate;
  if (!isISODate(value)) throw new RevisionError('invalid_change', 'Use a valid date.');
  withDate(() => checkEventDate(value, today));
  notes.push(`Date: ${input.eventDate} → ${value}.`);
  return value;
}

function editedLocks(plan: Plan, lock: ManualChange['lock'], notes: string[]): Amounts {
  const locked = lockedAmounts(plan.budget.lines);
  const line = lock && plan.budget.lines.find((l) => l.key === lock.key);
  if (!lock || !line || lock.locked === Boolean(line.locked)) return locked;
  if (lock.locked) {
    locked[line.key] = line.amount;
    notes.push(`${line.label} kept fixed at ${formatMoney(line.amount, plan.input.currency)}.`);
  } else {
    delete locked[line.key];
    notes.push(`${line.label} will be recalculated with the rest of the budget.`);
  }
  return locked;
}

function editedContingency(plan: Plan, value: number | undefined, notes: string[]): number {
  const current = plan.budget.contingencyPct;
  const next = value !== undefined ? clampContingency(value) : current;
  if (next !== current) notes.push(`Contingency: ${current}% → ${next}%.`);
  return next;
}

function manualEntry(notes: string[], diff: RevisionEntry['diff'], at: string): RevisionEntry {
  return {
    id: newId(),
    at,
    kind: 'manual',
    request: 'Edited in the plan',
    understood: '',
    changes: [...notes, 'Recalculated in the app without AI.'],
    tradeoffs: [],
    diff,
  };
}

export function applyManualChange(plan: Plan, change: ManualChange, today: string): RevisionResult {
  const notes: string[] = [];
  const input: EventInput = {
    ...plan.input,
    totalBudget: editedTotal(plan.input, change.totalBudget, notes),
    guestCount: editedGuests(plan.input, change.guestCount, notes),
    priorities: editedPriorities(plan.input, change.priorities, notes),
    eventDate: editedDate(plan.input, change.eventDate, today, notes),
  };
  const locked = editedLocks(plan, change.lock, notes);
  const contingencyPct = editedContingency(plan, change.contingencyPct, notes);

  const budget = withBudget(() =>
    computeBudget({
      eventType: input.eventType,
      currency: input.currency,
      total: input.totalBudget,
      guestCount: input.guestCount,
      priorities: input.priorities,
      contingencyPct,
      aiFactors: plan.aiFactors,
      locked,
      rationales: lineRationales(plan),
      tradeoffs: plan.budget.tradeoffs,
    }),
  );

  const dateChanged = input.eventDate !== plan.input.eventDate;
  const tasks = dateChanged
    ? withDate(() => scheduleTasks(taskSeeds(plan.timeline.tasks), input.eventDate, today, newId))
    : plan.timeline.tasks;
  const daysUntil = withDate(() => checkEventDate(input.eventDate, today));
  const diff = diffPlans(plan, { input, budget }, []);
  const now = new Date().toISOString();

  return {
    diff,
    plan: {
      ...plan,
      version: plan.version + 1,
      updatedAt: now,
      input,
      budget,
      timeline: dateChanged ? { ...plan.timeline, tasks, warnings: timelineWarnings(input.eventType, daysUntil, tasks) } : plan.timeline,
      vendors: dateChanged ? redateVendors(input, plan.vendors, today) : plan.vendors,
      ideas: refreshIdeaFit(plan.ideas, budget),
      revisions: notes.length > 0 ? appendHistory(plan, manualEntry(notes, diff, now)) : plan.revisions,
    },
  };
}
