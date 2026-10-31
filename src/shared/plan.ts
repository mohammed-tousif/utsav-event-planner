import type { z } from 'zod';
import { categoriesFor, EVENT_CONFIG, type CategoryKey } from './constants';
import { clampContingency, clampFactor, computeBudget } from './budget';
import { addDays } from './dates';
import type { AiIdeaSchema, AiPlanDraft, AiVendorSchema, Budget, EventInput, Idea, Plan, PlanMeta, Vendor } from './schemas';
import { buildSchedule, checkEventDate, compressOffsets, scheduleTasks, timelineWarnings } from './timeline';
import { vendorTemplatesFor, type VendorKey } from './vendorCatalog';

type AiVendor = z.output<typeof AiVendorSchema>;
type AiIdea = z.output<typeof AiIdeaSchema>;

/** A random, unguessable id for plans, tasks and other records. */
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

/* ------------------------------------------------------------------ */
/* Vendors                                                              */
/* ------------------------------------------------------------------ */

type VendorTemplate = ReturnType<typeof vendorTemplatesFor>[number];

interface VendorContext {
  input: EventInput;
  /** AI guidance for this vendor, only when it explains why the vendor is needed. */
  ai: AiVendor | undefined;
  /** The same vendor in the previous version of the plan, to keep progress. */
  kept: Vendor | undefined;
  leadDays: number;
}

function standardReason(eventType: EventInput['eventType']): string {
  return `A standard part of a ${eventType === 'community' ? 'community event' : eventType} plan.`;
}

function initialStatus(template: VendorTemplate, input: EventInput): Vendor['status'] {
  return template.key === 'venue' && input.venueStatus === 'booked' ? 'booked' : 'not_started';
}

/** Why the vendor is needed and what to ask: Gemini's guidance where it gave some, the standard checklist otherwise. */
function vendorGuidance(template: VendorTemplate, ai: AiVendor | undefined, eventType: EventInput['eventType']) {
  if (!ai) {
    return {
      why: standardReason(eventType),
      questions: template.questions,
      compareOn: template.compareOn,
      redFlags: [],
      source: 'standard' as const,
    };
  }
  return {
    why: ai.why,
    questions: ai.questions.length ? ai.questions : template.questions,
    compareOn: ai.compareOn.length ? ai.compareOn : template.compareOn,
    redFlags: ai.redFlags,
    source: 'ai' as const,
  };
}

/** Progress the user recorded on the previous version of the plan, or a fresh start. */
function vendorProgress(template: VendorTemplate, kept: Vendor | undefined, input: EventInput) {
  if (kept) return { id: kept.id, status: kept.status, quote: kept.quote, notes: kept.notes };
  return { id: newId(), status: initialStatus(template, input), quote: null, notes: '' };
}

function vendorFromTemplate(template: VendorTemplate, { input, ai, kept, leadDays }: VendorContext): Vendor {
  return {
    ...vendorProgress(template, kept, input),
    ...vendorGuidance(template, ai, input.eventType),
    key: template.key,
    label: template.label,
    budgetCategory: template.budgetCategory,
    leadDays,
    bookByDate: addDays(input.eventDate, -leadDays),
  };
}

/**
 * Merges AI vendor guidance into the standard checklist. Every standard
 * category appears exactly once; AI entries for categories that do not
 * belong to this event type are dropped.
 */
export function buildVendors(input: EventInput, aiVendors: readonly AiVendor[], today: string, previous: readonly Vendor[] = []): Vendor[] {
  const templates = vendorTemplatesFor(input.eventType);
  const daysUntil = checkEventDate(input.eventDate, today);
  const fitted = compressOffsets(
    templates.map((t) => t.leadDays),
    daysUntil,
  );
  const aiByKey = new Map<VendorKey, AiVendor>();
  for (const vendor of aiVendors) if (vendor.why && !aiByKey.has(vendor.category)) aiByKey.set(vendor.category, vendor);
  const previousByKey = new Map(previous.map((v) => [v.key, v] as const));

  return templates.map((template, index) =>
    vendorFromTemplate(template, {
      input,
      ai: aiByKey.get(template.key),
      kept: previousByKey.get(template.key),
      leadDays: fitted[index] ?? 0,
    }),
  );
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

/** Whether a cost fits inside the budget line it would come from. */
export function fitsLine(cost: number, category: CategoryKey, budget: Budget): boolean {
  const line = budget.lines.find((l) => l.key === category);
  return line ? cost <= line.amount : false;
}

/** Rechecks every idea against the current budget after amounts change. */
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
