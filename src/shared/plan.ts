import type { z } from 'zod';
import {
  categoriesFor,
  EVENT_CONFIG,
  type CategoryKey,
} from './constants';
import { clampContingency, clampFactor, computeBudget, lockedAmounts } from './budget';
import { addDays, daysBetween } from './dates';
import type {
  AiIdeaSchema,
  AiPlanDraft,
  AiVendorSchema,
  Budget,
  EventInput,
  Idea,
  Plan,
  PlanMeta,
  Vendor,
} from './schemas';
import { buildSchedule, checkEventDate, compressOffsets, scheduleTasks, timelineWarnings } from './timeline';
import { vendorTemplatesFor, type VendorKey } from './vendorCatalog';

type AiVendor = z.output<typeof AiVendorSchema>;
type AiIdea = z.output<typeof AiIdeaSchema>;

export const newId = (): string => globalThis.crypto.randomUUID();

/* ------------------------------------------------------------------ */
/* Budget                                                               */
/* ------------------------------------------------------------------ */

export function factorsFromAdjustments(
  input: EventInput,
  adjustments: readonly { category: CategoryKey; factor: number; reason: string }[],
): { factors: Partial<Record<CategoryKey, number>>; rationales: Partial<Record<CategoryKey, string>> } {
  const allowed = new Set(categoriesFor(input.eventType));
  const factors: Partial<Record<CategoryKey, number>> = {};
  const rationales: Partial<Record<CategoryKey, string>> = {};
  for (const adjustment of adjustments) {
    if (!allowed.has(adjustment.category)) continue;
    factors[adjustment.category] = clampFactor(adjustment.factor);
    if (adjustment.reason) rationales[adjustment.category] = adjustment.reason;
  }
  return { factors, rationales };
}

/** Recomputes the budget for a plan's current inputs, keeping locks. */
export function rebuildBudget(
  input: EventInput,
  previous: Pick<Budget, 'contingencyPct' | 'lines' | 'tradeoffs'>,
  aiFactors: Partial<Record<CategoryKey, number>>,
  options: { locked?: Partial<Record<CategoryKey, number>>; rationales?: Partial<Record<CategoryKey, string>>; tradeoffs?: string[] } = {},
): Budget {
  const rationales: Partial<Record<CategoryKey, string>> = {};
  for (const line of previous.lines) if (line.rationale) rationales[line.key] = line.rationale;
  return computeBudget({
    eventType: input.eventType,
    currency: input.currency,
    total: input.totalBudget,
    guestCount: input.guestCount,
    priorities: input.priorities,
    contingencyPct: previous.contingencyPct,
    aiFactors,
    locked: options.locked ?? lockedAmounts(previous.lines),
    rationales: { ...rationales, ...options.rationales },
    tradeoffs: options.tradeoffs ?? previous.tradeoffs,
  });
}

/* ------------------------------------------------------------------ */
/* Vendors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Merges AI vendor guidance into the standard checklist. Every standard
 * category appears exactly once; AI entries for categories that do not
 * belong to this event type are dropped.
 */
export function buildVendors(
  input: EventInput,
  aiVendors: readonly AiVendor[],
  today: string,
  previous: readonly Vendor[] = [],
): Vendor[] {
  const templates = vendorTemplatesFor(input.eventType);
  const daysUntil = checkEventDate(input.eventDate, today);
  const fitted = compressOffsets(templates.map((t) => t.leadDays), daysUntil);
  const byKey = new Map<VendorKey, AiVendor>();
  for (const vendor of aiVendors) if (!byKey.has(vendor.category)) byKey.set(vendor.category, vendor);
  const previousByKey = new Map(previous.map((v) => [v.key, v] as const));

  return templates.map((template, index): Vendor => {
    const found = byKey.get(template.key);
    const ai = found && found.why ? found : undefined;
    const kept = previousByKey.get(template.key);
    const leadDays = fitted[index] ?? 0;
    return {
      id: kept?.id ?? newId(),
      key: template.key,
      label: template.label,
      why: ai?.why || `A standard part of a ${input.eventType === 'community' ? 'community event' : input.eventType} plan.`,
      questions: ai?.questions.length ? ai.questions : template.questions,
      compareOn: ai?.compareOn.length ? ai.compareOn : template.compareOn,
      redFlags: ai?.redFlags ?? [],
      budgetCategory: template.budgetCategory,
      leadDays,
      bookByDate: addDays(input.eventDate, -leadDays),
      status: kept?.status ?? (template.key === 'venue' && input.venueStatus === 'booked' ? 'booked' : 'not_started'),
      quote: kept?.quote ?? null,
      notes: kept?.notes ?? '',
      source: ai ? 'ai' : 'standard',
    };
  });
}

/** Re-dates vendor booking deadlines after a date change, keeping progress. */
export function redateVendors(input: EventInput, vendors: readonly Vendor[], today: string): Vendor[] {
  const templates = new Map(vendorTemplatesFor(input.eventType).map((t) => [t.key, t] as const));
  const daysUntil = checkEventDate(input.eventDate, today);
  const leads = vendors.map((v) => templates.get(v.key)?.leadDays ?? v.leadDays);
  const fitted = compressOffsets(leads, daysUntil);
  return vendors.map((vendor, index) => {
    const leadDays = fitted[index] ?? 0;
    return { ...vendor, leadDays, bookByDate: addDays(input.eventDate, -leadDays) };
  });
}

/* ------------------------------------------------------------------ */
/* Ideas                                                                */
/* ------------------------------------------------------------------ */

export function buildIdeas(input: EventInput, aiIdeas: readonly AiIdea[], budget: Budget): Idea[] {
  const allowed = new Set(categoriesFor(input.eventType));
  const fallback: CategoryKey = allowed.has('decor') ? 'decor' : (categoriesFor(input.eventType)[0] ?? 'venue');
  return aiIdeas
    .filter((idea) => idea.title)
    .map((idea) => {
      const budgetCategory = allowed.has(idea.budgetCategory) ? idea.budgetCategory : fallback;
      const estimatedCost = Math.max(0, Math.round(idea.estimatedCost));
      return {
        id: newId(),
        title: idea.title,
        description: idea.description,
        whyItFits: idea.whyItFits,
        estimatedCost,
        budgetCategory,
        effort: idea.effort,
        fitsBudget: fitsLine(estimatedCost, budgetCategory, budget),
      };
    });
}

export function fitsLine(cost: number, category: CategoryKey, budget: Budget): boolean {
  const line = budget.lines.find((l) => l.key === category);
  return line ? cost <= line.amount : false;
}

export function refreshIdeaFit(ideas: readonly Idea[], budget: Budget): Idea[] {
  return ideas.map((idea) => ({ ...idea, fitsBudget: fitsLine(idea.estimatedCost, idea.budgetCategory, budget) }));
}

/* ------------------------------------------------------------------ */
/* Whole plan                                                           */
/* ------------------------------------------------------------------ */

/** Turns a validated AI draft into a complete, internally consistent plan. */
export function assemblePlan(input: EventInput, draft: AiPlanDraft, meta: PlanMeta, today: string): Plan {
  const daysUntil = checkEventDate(input.eventDate, today);
  const { factors, rationales } = factorsFromAdjustments(input, draft.adjustments);
  const contingencyPct = clampContingency(
    Number.isFinite(draft.contingencyPct) && draft.contingencyPct > 0
      ? Math.min(15, Math.max(5, draft.contingencyPct))
      : EVENT_CONFIG[input.eventType].defaultContingencyPct,
  );
  const budget = computeBudget({
    eventType: input.eventType,
    currency: input.currency,
    total: input.totalBudget,
    guestCount: input.guestCount,
    priorities: input.priorities,
    contingencyPct,
    aiFactors: factors,
    rationales,
    tradeoffs: draft.tradeoffs,
  });

  const tasks = scheduleTasks(draft.tasks, input.eventDate, today, newId);
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: newId(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    input,
    summary: draft.summary,
    assumptions: draft.assumptions,
    aiFactors: factors,
    budget,
    timeline: {
      tasks,
      schedule: buildSchedule(draft.schedule, newId),
      warnings: timelineWarnings(input.eventType, daysUntil, tasks),
    },
    vendors: buildVendors(input, draft.vendors, today),
    ideas: buildIdeas(input, draft.ideas, budget),
    revisions: [],
    meta,
  };
}

export function daysToGo(plan: Pick<Plan, 'input'>, today: string): number {
  return daysBetween(today, plan.input.eventDate);
}
