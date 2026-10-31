import { categoriesFor, MAX_BUDGET, MAX_GUESTS, type CategoryKey } from '../constants';
import { clampFactor, computeBudget, lockedAmounts, type BudgetParams } from '../budget';
import { isISODate } from '../dates';
import { formatMoney, roundingStep } from '../money';
import { buildIdeas, buildVendors, factorsFromAdjustments, newId, redateVendors, refreshIdeaFit } from '../plan';
import type { AiRevision, Budget, EventInput, Plan, PlanDiff, RevisionEntry, Task } from '../schemas';
import { buildSchedule, checkEventDate, scheduleTasks, timelineWarnings, type TaskSeed } from '../timeline';
import { diffHasChanges, diffPlans } from './diff';
import { RevisionError, withBudget, withDate } from './errors';
import { parseIntent, type ParsedIntent } from './intent';

type Amounts = Partial<Record<CategoryKey, number>>;
type Rationales = Partial<Record<CategoryKey, string>>;

const MAX_HISTORY = 50;

export interface RevisionResult {
  plan: Plan;
  diff: PlanDiff;
}

/** What every step of a revision works from. */
interface RevisionContext {
  plan: Plan;
  /** Event details after this revision. */
  input: EventInput;
  revision: AiRevision;
  today: string;
}

/** Turns scheduled tasks back into seeds so they can be re-dated. */
export function taskSeeds(tasks: readonly Task[]): TaskSeed[] {
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

/** The reason shown on each budget line, so it survives recalculation. */
export function lineRationales(plan: Plan): Rationales {
  const rationales: Rationales = {};
  for (const line of plan.budget.lines) if (line.rationale) rationales[line.key] = line.rationale;
  return rationales;
}

/** Adds a change to the plan's history, newest first, keeping the most recent ones. */
export function appendHistory(plan: Plan, entry: RevisionEntry): RevisionEntry[] {
  return [entry, ...plan.revisions].slice(0, MAX_HISTORY);
}

/* ---------- Step 1: the new event details ---------- */

function validAiTotal(value: number): number | undefined {
  return value > 0 && value <= MAX_BUDGET ? Math.round(value) : undefined;
}

function validAiGuests(value: number): number | undefined {
  return Number.isInteger(value) && value >= 1 && value <= MAX_GUESTS ? value : undefined;
}

function revisedDate(current: string, proposed: string, today: string): string {
  if (!proposed || proposed === current) return current;
  if (!isISODate(proposed)) throw new RevisionError('invalid_change', 'The new event date could not be understood. Try a specific date.');
  withDate(() => checkEventDate(proposed, today));
  return proposed;
}

/** Exact numbers parsed from the request win over the model's values. */
function revisedInput(plan: Plan, revision: AiRevision, intent: ParsedIntent, today: string): EventInput {
  const input = plan.input;
  return {
    ...input,
    totalBudget: intent.totalBudget ?? validAiTotal(revision.totalBudget) ?? input.totalBudget,
    guestCount: intent.guestCount ?? validAiGuests(revision.guestCount) ?? input.guestCount,
    eventDate: revisedDate(input.eventDate, revision.eventDate, today),
    style: revision.style || input.style,
  };
}

/* ---------- Step 2: locks and AI weight changes ---------- */

/** Current locks, minus what the AI was asked to unlock, plus what it was asked to keep. */
function revisedLocks(plan: Plan, revision: AiRevision): Amounts {
  const allowed = new Set(categoriesFor(plan.input.eventType));
  const locked = lockedAmounts(plan.budget.lines);
  for (const key of revision.unlockCategories) delete locked[key];
  for (const key of revision.lockCategories) {
    const line = plan.budget.lines.find((l) => l.key === key);
    if (allowed.has(key) && line) locked[key] = line.amount;
  }
  return locked;
}

interface WeightChanges {
  /** Factors requested by this revision, relative to the current plan. */
  factors: Amounts;
  rationales: Rationales;
  /** The plan's cumulative AI factors after this revision. */
  aiFactors: Amounts;
}

function weightChanges({ plan, input, revision }: RevisionContext, locked: Amounts): WeightChanges {
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
  return { factors, rationales, aiFactors };
}

/* ---------- Step 3: the budget ---------- */

const sum = (amounts: Amounts): number => Object.values(amounts).reduce<number>((total, v) => total + (v ?? 0), 0);

function contingencyNote(freed: number, currency: EventInput['currency']): string[] {
  if (freed === 0) return [];
  const amount = formatMoney(Math.abs(freed), currency);
  return [
    freed > 0
      ? `${amount} freed and kept in contingency. Other categories are unchanged.`
      : `${amount} taken from contingency. Other categories are unchanged.`,
  ];
}

/**
 * A targeted edit ("reduce decoration costs") changes only the named
 * categories; every other line stays put and contingency absorbs the
 * difference. Returns undefined when the edit does not fit the total.
 */
function targetedBudget(plan: Plan, params: BudgetParams, factors: Amounts): { budget: Budget; notes: string[] } | undefined {
  const locked = params.locked ?? {};
  const step = roundingStep(params.currency, params.total);
  const fixed: Amounts = {};
  for (const line of plan.budget.lines) {
    if (locked[line.key] !== undefined) continue;
    const factor = factors[line.key];
    fixed[line.key] = factor === undefined ? line.amount : Math.max(0, Math.round((line.amount * factor) / step) * step);
  }
  if (sum(fixed) + sum(locked) > params.total) return undefined;
  const budget = withBudget(() => computeBudget({ ...params, fixed }));
  return { budget, notes: contingencyNote(budget.contingency - plan.budget.contingency, params.currency) };
}

function revisedBudget({ plan, input, revision }: RevisionContext, locked: Amounts, weights: WeightChanges) {
  const params: BudgetParams = {
    eventType: input.eventType,
    currency: input.currency,
    total: input.totalBudget,
    guestCount: input.guestCount,
    priorities: input.priorities,
    contingencyPct: plan.budget.contingencyPct,
    aiFactors: weights.aiFactors,
    locked,
    rationales: { ...lineRationales(plan), ...weights.rationales },
    tradeoffs: revision.tradeoffs.length ? revision.tradeoffs : plan.budget.tradeoffs,
  };
  // Any change to the total or the guests rebalances everything.
  const isTargeted =
    Object.keys(weights.factors).length > 0 && input.totalBudget === plan.input.totalBudget && input.guestCount === plan.input.guestCount;
  const targeted = isTargeted ? targetedBudget(plan, params, weights.factors) : undefined;
  return targeted ?? { budget: withBudget(() => computeBudget(params)), notes: [] };
}

/* ---------- Step 4: timeline, vendors and ideas ---------- */

interface Sections {
  tasks: Task[];
  schedule: Plan['timeline']['schedule'];
  vendors: Plan['vendors'];
  ideas: Plan['ideas'];
  regenerated: PlanDiff['regenerated'];
}

/** Rewrites only the sections the AI asked to rewrite (with enough content); re-dates the rest. */
function revisedSections({ plan, input, revision, today }: RevisionContext, budget: Budget): Sections {
  const regenerated: PlanDiff['regenerated'] = [];
  const rewrite = (section: PlanDiff['regenerated'][number], wanted: boolean, enough: boolean) => {
    if (wanted && enough) regenerated.push(section);
    return wanted && enough;
  };

  // Completed tasks stay completed when the task list is rewritten.
  const doneByTitle = new Map(plan.timeline.tasks.map((t) => [t.title.toLowerCase(), t.done] as const));
  const seeds = rewrite('tasks', revision.regenerateTasks, revision.tasks.length >= 3)
    ? revision.tasks.map((task) => ({ ...task, done: doneByTitle.get(task.title.toLowerCase()) ?? false }))
    : taskSeeds(plan.timeline.tasks);
  const tasks = withDate(() => scheduleTasks(seeds, input.eventDate, today, newId));

  const schedule = rewrite('schedule', revision.regenerateSchedule, revision.schedule.length >= 2)
    ? buildSchedule(revision.schedule, newId)
    : plan.timeline.schedule;
  const vendors = rewrite('vendors', revision.regenerateVendors, revision.vendors.length > 0)
    ? buildVendors(input, revision.vendors, today, plan.vendors)
    : redateVendors(input, plan.vendors, today);
  const ideas = rewrite('ideas', revision.regenerateIdeas, revision.ideas.length >= 2)
    ? buildIdeas(input, revision.ideas, budget)
    : refreshIdeaFit(plan.ideas, budget);

  return { tasks, schedule, vendors, ideas, regenerated };
}

/* ---------- Putting it together ---------- */

/**
 * Applies a validated AI revision to a plan. The AI decides *what* should
 * change; this function decides *how much*, recalculating every number so
 * the plan stays consistent. Throws RevisionError when nothing would change
 * or when the change cannot be satisfied.
 */
export function applyRevision(plan: Plan, revision: AiRevision, request: string, today: string): RevisionResult {
  const intent = parseIntent(request, plan.input);
  const ctx: RevisionContext = { plan, input: revisedInput(plan, revision, intent, today), revision, today };
  const { input } = ctx;
  const locked = revisedLocks(plan, revision);
  const weights = weightChanges(ctx, locked);
  const { budget, notes: budgetNotes } = revisedBudget(ctx, locked, weights);
  const sections = revisedSections(ctx, budget);

  const diff = diffPlans(plan, { input, budget }, sections.regenerated);
  if (!diffHasChanges(plan, diff, input.style !== plan.input.style)) {
    throw new RevisionError(
      'no_change',
      revision.understood || 'That request did not change the plan. Try naming the budget, guests, date or a section to change.',
    );
  }

  const entry: RevisionEntry = {
    id: newId(),
    at: new Date().toISOString(),
    kind: 'ai',
    request,
    understood: revision.understood,
    changes: [...intent.notes, ...budgetNotes, ...revision.changeSummary],
    tradeoffs: revision.tradeoffs,
    diff,
  };
  const daysUntil = checkEventDate(input.eventDate, today);
  return {
    diff,
    plan: {
      ...plan,
      version: plan.version + 1,
      updatedAt: entry.at,
      input,
      aiFactors: weights.aiFactors,
      budget,
      timeline: {
        tasks: sections.tasks,
        schedule: sections.schedule,
        warnings: timelineWarnings(input.eventType, daysUntil, sections.tasks),
      },
      vendors: sections.vendors,
      ideas: sections.ideas,
      revisions: appendHistory(plan, entry),
    },
  };
}
