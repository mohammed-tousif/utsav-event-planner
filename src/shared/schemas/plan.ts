/** The saved plan, as stored in the browser and sent back for revisions. */
import { z } from 'zod';
import { CATEGORY_KEYS, CURRENCIES, TASK_AREAS, TASK_PRIORITIES } from '../constants';
import { VENDOR_KEYS } from '../vendorCatalog';
import { isoDate } from './fields';
import { EventInputSchema } from './input';

const money = z.number().finite().min(0);

export const BudgetLineSchema = z.object({
  key: z.enum(CATEGORY_KEYS),
  label: z.string(),
  amount: money,
  weight: z.number().finite().min(0),
  locked: z.boolean(),
  rationale: z.string(),
});
export type BudgetLine = z.infer<typeof BudgetLineSchema>;

export const BudgetWarningSchema = z.object({
  code: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});
export type BudgetWarning = z.infer<typeof BudgetWarningSchema>;

export const BudgetSchema = z.object({
  currency: z.enum(CURRENCIES),
  total: money,
  contingencyPct: z.number().min(0).max(30),
  contingency: money,
  lines: z.array(BudgetLineSchema),
  perGuest: money,
  warnings: z.array(BudgetWarningSchema),
  tradeoffs: z.array(z.string()),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  area: z.enum(TASK_AREAS),
  priority: z.enum(TASK_PRIORITIES),
  notes: z.string(),
  idealOffsetDays: z.number().int().min(0),
  offsetDays: z.number().int().min(0),
  dueDate: isoDate,
  compressed: z.boolean(),
  done: z.boolean(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ScheduleItemSchema = z.object({
  id: z.string(),
  segment: z.string(),
  time: z.string(),
  durationMin: z.number().int(),
  title: z.string(),
  notes: z.string(),
  overlaps: z.boolean(),
});
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;

export const VENDOR_STATUSES = ['not_started', 'researching', 'contacted', 'quote_received', 'booked'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VendorSchema = z.object({
  id: z.string(),
  key: z.enum(VENDOR_KEYS),
  label: z.string(),
  why: z.string(),
  questions: z.array(z.string()),
  compareOn: z.array(z.string()),
  redFlags: z.array(z.string()),
  budgetCategory: z.enum(CATEGORY_KEYS),
  leadDays: z.number().int().min(0),
  bookByDate: isoDate,
  status: z.enum(VENDOR_STATUSES),
  quote: z.number().finite().min(0).nullable(),
  notes: z.string().max(500),
  source: z.enum(['ai', 'standard']),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const IdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  whyItFits: z.string(),
  estimatedCost: money,
  budgetCategory: z.enum(CATEGORY_KEYS),
  effort: z.enum(['low', 'medium', 'high']),
  fitsBudget: z.boolean(),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const PlanDiffSchema = z.object({
  totalBefore: money,
  totalAfter: money,
  guestsBefore: z.number().int(),
  guestsAfter: z.number().int(),
  dateBefore: isoDate,
  dateAfter: isoDate,
  lines: z.array(z.object({ key: z.enum(CATEGORY_KEYS), label: z.string(), before: money, after: money })),
  contingencyBefore: money,
  contingencyAfter: money,
  regenerated: z.array(z.enum(['tasks', 'schedule', 'vendors', 'ideas'])),
  locked: z.array(z.enum(CATEGORY_KEYS)),
});
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

export const RevisionEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(['ai', 'manual']),
  request: z.string(),
  understood: z.string(),
  changes: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  diff: PlanDiffSchema,
});
export type RevisionEntry = z.infer<typeof RevisionEntrySchema>;

export const AiExchangeSchema = z.object({
  kind: z.enum(['plan', 'revision']),
  model: z.string(),
  at: z.string(),
  prompt: z.string().max(24_000),
  reply: z.string().max(60_000),
});
export type AiExchange = z.infer<typeof AiExchangeSchema>;

export const PlanMetaSchema = z.object({
  source: z.enum(['ai', 'sample']),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  /** The latest prompt sent to the AI and its raw reply, kept for transparency. */
  exchange: AiExchangeSchema.optional(),
});
export type PlanMeta = z.infer<typeof PlanMetaSchema>;

export const PlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(64),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  input: EventInputSchema,
  summary: z.string(),
  assumptions: z.array(z.string()),
  aiFactors: z.partialRecord(z.enum(CATEGORY_KEYS), z.number()),
  budget: BudgetSchema,
  timeline: z.object({
    tasks: z.array(TaskSchema),
    schedule: z.array(ScheduleItemSchema),
    warnings: z.array(z.string()),
  }),
  vendors: z.array(VendorSchema),
  ideas: z.array(IdeaSchema),
  revisions: z.array(RevisionEntrySchema).max(50),
  meta: PlanMetaSchema,
});
export type Plan = z.output<typeof PlanSchema>;
