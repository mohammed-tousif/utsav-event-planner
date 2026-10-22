import { categoriesFor, MAX_BUDGET, MAX_GUESTS, type CategoryKey, type PriorityKey } from './constants';
import { BudgetInfeasibleError, clampContingency, clampFactor, computeBudget, lockedAmounts } from './budget';
import { isISODate } from './dates';
import { formatMoney, roundingStep } from './money';
import {
  buildIdeas,
  buildVendors,
  factorsFromAdjustments,
  newId,
  redateVendors,
  refreshIdeaFit,
} from './plan';
import type { AiRevision, Budget, EventInput, Plan, PlanDiff, RevisionEntry, Task } from './schemas';
import { buildSchedule, checkEventDate, DateRangeError, scheduleTasks, timelineWarnings, type TaskSeed } from './timeline';

export class RevisionError extends Error {
  constructor(
    public readonly code: 'no_change' | 'infeasible' | 'invalid_change',
    message: string,
  ) {
    super(message);
    this.name = 'RevisionError';
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic reading of numeric requests                            */
/* ------------------------------------------------------------------ */

const CATEGORY_WORDS =
  /\b(venue|hall|food|catering|caterer|menu|decor|decoration|decorations|flowers|photo|photos|photography|video|music|dj|band|entertainment|outfit|outfits|attire|makeup|mehendi|invite|invites|invitations|cake|gifts?|favou?rs|transport|stay|sound|lights?|permits?|security|publicity|printing|volunteers?)\b/i;

const UNIT_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  cr: 10_000_000,
};

function parseAmount(raw: string, unit?: string): number | undefined {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * (unit ? (UNIT_MULTIPLIER[unit.toLowerCase()] ?? 1) : 1));
}

export interface ParsedIntent {
  totalBudget?: number;
  guestCount?: number;
  notes: string[];
}

/**
 * Reads exact numbers from requests like "reduce the budget by 20%" or
 * "increase the guest count from 50 to 80". These values are computed in
 * code and take precedence over the model's arithmetic. Requests about a
 * single category ("cut the decor budget by 20%") are left to the AI.
 */
export function parseIntent(request: string, input: Pick<EventInput, 'totalBudget' | 'guestCount' | 'currency'>): ParsedIntent {
  const text = request.toLowerCase().replace(/\s+/g, ' ');
  const notes: string[] = [];
  const result: ParsedIntent = { notes };

  // Total budget by percentage.
  const pct = /\b(reduce|cut|lower|decrease|trim|slash|drop|increase|raise|boost|grow)\b(.{0,40}?)\bbudget\b.{0,25}?\bby\s*(\d{1,2}(?:\.\d+)?)\s*(?:%|percent)/.exec(text);
  if (pct && !CATEGORY_WORDS.test(pct[2] ?? '')) {
    const up = /increase|raise|boost|grow/.test(pct[1] ?? '');
    const percent = Number(pct[3]);
    const factor = up ? 1 + percent / 100 : 1 - percent / 100;
    if (percent > 0 && factor > 0) {
      result.totalBudget = Math.round(input.totalBudget * factor);
      notes.push(
        `Total budget ${up ? 'raised' : 'reduced'} by exactly ${percent}%: ${formatMoney(input.totalBudget, input.currency)} → ${formatMoney(result.totalBudget, input.currency)}.`,
      );
    }
  }

  // Total budget to an absolute amount.
  if (result.totalBudget === undefined) {
    const abs = /\b(?:total |overall |the |our |my )?budget\b(.{0,20}?)\b(?:to|of|at)\s*(?:₹|rs\.?|inr|\$|usd|€|£)?\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|k|thousand|crores?|cr)?\b/.exec(text);
    const before = abs ? text.slice(Math.max(0, abs.index - 25), abs.index) : '';
    if (abs && !CATEGORY_WORDS.test(`${before} ${abs[1] ?? ''}`)) {
      const amount = parseAmount(abs[2] ?? '', abs[3]);
      if (amount && amount <= MAX_BUDGET) {
        result.totalBudget = amount;
        notes.push(`Total budget set to ${formatMoney(amount, input.currency)}.`);
      }
    }
  }

  // Guest count.
  const guestWord = /\b(guests?|people|attendees|headcount|persons|pax|invitees)\b/;
  if (guestWord.test(text)) {
    let guests: number | undefined;
    let mismatchNoted = false;
    const fromTo = /\bfrom\s+(\d{1,4})\s*(?:guests?|people)?\s+to\s+(\d{1,4})\b/.exec(text);
    const toN = /\b(?:guests?|guest count|headcount|people|attendees)\b.{0,25}?\bto\s+(\d{1,4})\b/.exec(text);
    const more = /\b(?:add|invite|another|plus)\s+(\d{1,4})\s+(?:more\s+)?(?:guests?|people)\b/.exec(text);
    const fewer = /\b(?:remove|drop|cut|minus)\s+(\d{1,4})\s+(?:guests?|people)\b|\b(\d{1,4})\s+(?:fewer|less)\s+(?:guests?|people)\b/.exec(text);
    const set = /\b(?:for|make it|now|with|only|expect(?:ing)?)\s+(\d{1,4})\s+(?:guests?|people|attendees)\b/.exec(text);
    if (fromTo) {
      guests = Number(fromTo[2]);
      if (Number(fromTo[1]) !== input.guestCount) {
        notes.push(`Your plan had ${input.guestCount} guests, not ${fromTo[1]}; it now uses ${guests}.`);
        mismatchNoted = true;
      }
    }
    else if (toN) guests = Number(toN[1]);
    else if (more) guests = input.guestCount + Number(more[1]);
    else if (fewer) guests = input.guestCount - Number(fewer[1] ?? fewer[2]);
    else if (set) guests = Number(set[1]);
    if (guests !== undefined && Number.isInteger(guests) && guests >= 1 && guests <= MAX_GUESTS && guests !== input.guestCount) {
      result.guestCount = guests;
      if (!mismatchNoted) notes.push(`Guest count changed from ${input.guestCount} to ${guests}.`);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Diff                                                                 */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Applying an AI revision                                              */
/* ------------------------------------------------------------------ */

function taskSeeds(tasks: readonly Task[]): TaskSeed[] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    area: task.area,
    priority: task.priority,
    notes: task.notes,
    offsetDays: task.idealOffsetDays,
    done: task.done,
  }));
}

function withBudget(build: () => Budget): Budget {
  try {
    return build();
  } catch (error) {
    if (error instanceof BudgetInfeasibleError) throw new RevisionError('infeasible', error.message);
    throw error;
  }
}

function withDate<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof DateRangeError) throw new RevisionError('invalid_change', error.message);
    throw error;
  }
}

/**
 * Applies a validated AI revision to a plan. The AI decides *what* should
 * change; this function decides *how much*, recalculating every number so
 * the plan stays consistent. Throws RevisionError when nothing would change
 * or when the change cannot be satisfied.
 */
export function applyRevision(plan: Plan, revision: AiRevision, request: string, today: string): { plan: Plan; diff: PlanDiff } {
  const intent = parseIntent(request, plan.input);
  const allowed = new Set(categoriesFor(plan.input.eventType));
  const input: EventInput = { ...plan.input };

  const aiTotal = revision.totalBudget > 0 && revision.totalBudget <= MAX_BUDGET ? Math.round(revision.totalBudget) : undefined;
  input.totalBudget = intent.totalBudget ?? aiTotal ?? input.totalBudget;

  const aiGuests =
    Number.isInteger(revision.guestCount) && revision.guestCount >= 1 && revision.guestCount <= MAX_GUESTS
      ? revision.guestCount
      : undefined;
  input.guestCount = intent.guestCount ?? aiGuests ?? input.guestCount;

  if (revision.eventDate && revision.eventDate !== input.eventDate) {
    if (!isISODate(revision.eventDate)) throw new RevisionError('invalid_change', 'The new event date could not be understood. Try a specific date.');
    withDate(() => checkEventDate(revision.eventDate, today));
    input.eventDate = revision.eventDate;
  }
  if (revision.style && revision.style !== input.style) input.style = revision.style;

  // Locks: keep current amounts for categories the user wants unchanged.
  const locked = lockedAmounts(plan.budget.lines);
  for (const key of revision.unlockCategories) delete locked[key];
  for (const key of revision.lockCategories) {
    if (!allowed.has(key)) continue;
    const line = plan.budget.lines.find((l) => l.key === key);
    if (line) locked[key] = line.amount;
  }

  const { factors, rationales } = factorsFromAdjustments(input, revision.adjustments);
  for (const key of Object.keys(locked) as CategoryKey[]) {
    delete factors[key];
    delete rationales[key];
  }
  // Revision factors are relative to the current plan, so they compound.
  const aiFactors = { ...plan.aiFactors };
  for (const [key, factor] of Object.entries(factors) as [CategoryKey, number][]) {
    aiFactors[key] = clampFactor((plan.aiFactors[key] ?? 1) * factor);
  }

  const previousRationales: Partial<Record<CategoryKey, string>> = {};
  for (const line of plan.budget.lines) if (line.rationale) previousRationales[line.key] = line.rationale;

  const base = {
    eventType: input.eventType,
    currency: input.currency,
    total: input.totalBudget,
    guestCount: input.guestCount,
    priorities: input.priorities,
    contingencyPct: plan.budget.contingencyPct,
    aiFactors,
    locked,
    rationales: { ...previousRationales, ...rationales },
    tradeoffs: revision.tradeoffs.length ? revision.tradeoffs : plan.budget.tradeoffs,
  };

  // A targeted edit ("reduce decoration costs") changes only the named
  // categories; every other line stays put and contingency absorbs the
  // difference. Any change to the total or guests rebalances everything.
  const targeted =
    Object.keys(factors).length > 0 &&
    input.totalBudget === plan.input.totalBudget &&
    input.guestCount === plan.input.guestCount;
  const targetNotes: string[] = [];
  let budget: Budget | undefined;
  if (targeted) {
    const fixed: Partial<Record<CategoryKey, number>> = {};
    const step = roundingStep(input.currency, input.totalBudget);
    for (const line of plan.budget.lines) {
      if (locked[line.key] !== undefined) continue;
      const factor = factors[line.key];
      fixed[line.key] = factor === undefined ? line.amount : Math.max(0, Math.round((line.amount * factor) / step) * step);
    }
    const fixedSum = Object.values(fixed).reduce((sum, v) => sum + (v ?? 0), 0);
    const lockedSum = Object.values(locked).reduce((sum, v) => sum + (v ?? 0), 0);
    if (fixedSum + lockedSum <= input.totalBudget) {
      budget = withBudget(() => computeBudget({ ...base, fixed }));
      const freed = budget.contingency - plan.budget.contingency;
      if (freed !== 0) {
        targetNotes.push(
          freed > 0
            ? `${formatMoney(freed, input.currency)} freed and kept in contingency. Other categories are unchanged.`
            : `${formatMoney(-freed, input.currency)} taken from contingency. Other categories are unchanged.`,
        );
      }
    }
  }
  budget ??= withBudget(() => computeBudget(base));

  const regenerated: PlanDiff['regenerated'] = [];
  const doneByTitle = new Map(plan.timeline.tasks.map((t) => [t.title.toLowerCase(), t.done] as const));
  let seeds = taskSeeds(plan.timeline.tasks);
  if (revision.regenerateTasks && revision.tasks.length >= 3) {
    seeds = revision.tasks.map((task) => ({ ...task, done: doneByTitle.get(task.title.toLowerCase()) ?? false }));
    regenerated.push('tasks');
  }
  const tasks = withDate(() => scheduleTasks(seeds, input.eventDate, today, newId));

  let schedule = plan.timeline.schedule;
  if (revision.regenerateSchedule && revision.schedule.length >= 2) {
    schedule = buildSchedule(revision.schedule, newId);
    regenerated.push('schedule');
  }

  let vendors = redateVendors(input, plan.vendors, today);
  if (revision.regenerateVendors && revision.vendors.length > 0) {
    vendors = buildVendors(input, revision.vendors, today, plan.vendors);
    regenerated.push('vendors');
  }

  let ideas = refreshIdeaFit(plan.ideas, budget);
  if (revision.regenerateIdeas && revision.ideas.length >= 2) {
    ideas = buildIdeas(input, revision.ideas, budget);
    regenerated.push('ideas');
  }

  const diff = diffPlans(plan, { input, budget }, regenerated);
  const budgetChanged =
    diff.totalBefore !== diff.totalAfter ||
    diff.contingencyBefore !== diff.contingencyAfter ||
    diff.lines.some((l) => l.before !== l.after);
  const lockChanged = diff.locked.join() !== plan.budget.lines.filter((l) => l.locked).map((l) => l.key).join();
  const changed =
    budgetChanged ||
    lockChanged ||
    regenerated.length > 0 ||
    diff.guestsBefore !== diff.guestsAfter ||
    diff.dateBefore !== diff.dateAfter ||
    input.style !== plan.input.style;
  if (!changed) {
    throw new RevisionError(
      'no_change',
      revision.understood || 'That request did not change the plan. Try naming the budget, guests, date or a section to change.',
    );
  }

  const daysUntil = checkEventDate(input.eventDate, today);
  const entry: RevisionEntry = {
    id: newId(),
    at: new Date().toISOString(),
    kind: 'ai',
    request,
    understood: revision.understood,
    changes: [...intent.notes, ...targetNotes, ...revision.changeSummary],
    tradeoffs: revision.tradeoffs,
    diff,
  };

  return {
    diff,
    plan: {
      ...plan,
      version: plan.version + 1,
      updatedAt: entry.at,
      input,
      aiFactors,
      budget,
      timeline: { tasks, schedule, warnings: timelineWarnings(input.eventType, daysUntil, tasks) },
      vendors,
      ideas,
      revisions: [entry, ...plan.revisions].slice(0, 50),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Direct edits made in the app (no AI involved)                        */
/* ------------------------------------------------------------------ */

export interface ManualChange {
  totalBudget?: number;
  guestCount?: number;
  contingencyPct?: number;
  priorities?: PriorityKey[];
  eventDate?: string;
  lock?: { key: CategoryKey; locked: boolean };
}

export function applyManualChange(plan: Plan, change: ManualChange, today: string): { plan: Plan; diff: PlanDiff } {
  const input: EventInput = { ...plan.input };
  const notes: string[] = [];
  if (change.totalBudget !== undefined && change.totalBudget !== input.totalBudget) {
    if (!Number.isFinite(change.totalBudget) || change.totalBudget < 1 || change.totalBudget > MAX_BUDGET) {
      throw new RevisionError('invalid_change', 'Enter a total budget greater than zero.');
    }
    notes.push(`Total budget: ${formatMoney(input.totalBudget, input.currency)} → ${formatMoney(change.totalBudget, input.currency)}.`);
    input.totalBudget = Math.round(change.totalBudget);
  }
  if (change.guestCount !== undefined && change.guestCount !== input.guestCount) {
    if (!Number.isInteger(change.guestCount) || change.guestCount < 1 || change.guestCount > MAX_GUESTS) {
      throw new RevisionError('invalid_change', `Guest count must be a whole number from 1 to ${MAX_GUESTS}.`);
    }
    notes.push(`Guests: ${input.guestCount} → ${change.guestCount}.`);
    input.guestCount = change.guestCount;
  }
  if (change.priorities) {
    input.priorities = [...new Set(change.priorities)].slice(0, 3);
    notes.push('Priorities updated.');
  }
  if (change.eventDate && change.eventDate !== input.eventDate) {
    if (!isISODate(change.eventDate)) throw new RevisionError('invalid_change', 'Use a valid date.');
    withDate(() => checkEventDate(change.eventDate as string, today));
    notes.push(`Date: ${input.eventDate} → ${change.eventDate}.`);
    input.eventDate = change.eventDate;
  }

  const locked = lockedAmounts(plan.budget.lines);
  if (change.lock) {
    const line = plan.budget.lines.find((l) => l.key === change.lock?.key);
    if (line && change.lock.locked && !line.locked) {
      locked[line.key] = line.amount;
      notes.push(`${line.label} kept fixed at ${formatMoney(line.amount, input.currency)}.`);
    } else if (line && !change.lock.locked && line.locked) {
      delete locked[line.key];
      notes.push(`${line.label} will be recalculated with the rest of the budget.`);
    }
  }
  const contingencyPct =
    change.contingencyPct !== undefined ? clampContingency(change.contingencyPct) : plan.budget.contingencyPct;
  if (contingencyPct !== plan.budget.contingencyPct) notes.push(`Contingency: ${plan.budget.contingencyPct}% → ${contingencyPct}%.`);

  const rationales: Partial<Record<CategoryKey, string>> = {};
  for (const line of plan.budget.lines) if (line.rationale) rationales[line.key] = line.rationale;
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
      rationales,
      tradeoffs: plan.budget.tradeoffs,
    }),
  );

  const dateChanged = input.eventDate !== plan.input.eventDate;
  const tasks = dateChanged
    ? withDate(() => scheduleTasks(taskSeeds(plan.timeline.tasks), input.eventDate, today, newId))
    : plan.timeline.tasks;
  const vendors = dateChanged ? redateVendors(input, plan.vendors, today) : plan.vendors;
  const daysUntil = withDate(() => checkEventDate(input.eventDate, today));
  const diff = diffPlans(plan, { input, budget }, []);
  const now = new Date().toISOString();
  const revisions =
    notes.length > 0
      ? [
          {
            id: newId(),
            at: now,
            kind: 'manual' as const,
            request: 'Edited in the plan',
            understood: '',
            changes: [...notes, 'Recalculated in the app without AI.'],
            tradeoffs: [],
            diff,
          },
          ...plan.revisions,
        ].slice(0, 50)
      : plan.revisions;

  return {
    diff,
    plan: {
      ...plan,
      version: plan.version + 1,
      updatedAt: now,
      input,
      budget,
      timeline: dateChanged
        ? { ...plan.timeline, tasks, warnings: timelineWarnings(input.eventType, daysUntil, tasks) }
        : plan.timeline,
      vendors,
      ideas: refreshIdeaFit(plan.ideas, budget),
      revisions,
    },
  };
}
