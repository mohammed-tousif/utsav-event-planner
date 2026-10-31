/** What the AI returns. Every reply is cleaned and validated against these schemas before use. */
import { z } from 'zod';
import { CATEGORY_KEYS, TASK_AREAS, TASK_PRIORITIES } from '../constants';
import { cleanText } from '../text';
import { VENDOR_KEYS } from '../vendorCatalog';

const aiText = (max: number) => z.string().transform((value) => cleanText(value).slice(0, max));
const aiList = (max: number, maxItems: number) => z.array(aiText(max)).transform((values) => values.filter(Boolean).slice(0, maxItems));

export const AiAdjustmentSchema = z.object({
  category: z.enum(CATEGORY_KEYS),
  factor: z.number().finite(),
  reason: aiText(200),
});

export const AiTaskSchema = z.object({
  title: aiText(120),
  area: z.enum(TASK_AREAS),
  offsetDays: z.number().finite(),
  priority: z.enum(TASK_PRIORITIES),
  notes: aiText(240),
});

export const AiScheduleItemSchema = z.object({
  segment: aiText(60),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.number().finite(),
  title: aiText(100),
  notes: aiText(200),
});

export const AiVendorSchema = z.object({
  category: z.enum(VENDOR_KEYS),
  why: aiText(240),
  questions: aiList(200, 5),
  compareOn: aiList(80, 4),
  redFlags: aiList(160, 3),
});

export const AiIdeaSchema = z.object({
  title: aiText(90),
  description: aiText(320),
  whyItFits: aiText(240),
  estimatedCost: z.number().finite(),
  budgetCategory: z.enum(CATEGORY_KEYS),
  effort: z.enum(['low', 'medium', 'high']),
});

/** What Gemini returns for a new plan. Amounts and dates are computed by the app, not taken from here. */
export const AiPlanDraftSchema = z.object({
  summary: aiText(500),
  contingencyPct: z.number().finite(),
  adjustments: z.array(AiAdjustmentSchema).max(20),
  tradeoffs: aiList(240, 5),
  tasks: z.array(AiTaskSchema).min(5, 'At least five tasks are expected.').max(30),
  schedule: z.array(AiScheduleItemSchema).min(2).max(24),
  vendors: z.array(AiVendorSchema).max(12),
  ideas: z.array(AiIdeaSchema).min(3).max(8),
  assumptions: aiList(200, 5),
});
export type AiPlanDraft = z.output<typeof AiPlanDraftSchema>;

/** What Gemini returns for a change request: what should change, never the final numbers. */
export const AiRevisionSchema = z.object({
  understood: aiText(240),
  totalBudget: z.number().finite(),
  guestCount: z.number().finite(),
  eventDate: z.string(),
  style: aiText(120),
  lockCategories: z.array(z.enum(CATEGORY_KEYS)).max(15),
  unlockCategories: z.array(z.enum(CATEGORY_KEYS)).max(15),
  adjustments: z.array(AiAdjustmentSchema).max(20),
  regenerateTasks: z.boolean(),
  regenerateSchedule: z.boolean(),
  regenerateVendors: z.boolean(),
  regenerateIdeas: z.boolean(),
  tasks: z.array(AiTaskSchema).max(30),
  schedule: z.array(AiScheduleItemSchema).max(24),
  vendors: z.array(AiVendorSchema).max(12),
  ideas: z.array(AiIdeaSchema).max(8),
  changeSummary: aiList(240, 6),
  tradeoffs: aiList(240, 5),
});
export type AiRevision = z.output<typeof AiRevisionSchema>;
