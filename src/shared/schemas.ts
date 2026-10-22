import { z } from 'zod';
import {
  ACCESSIBILITY_KEYS,
  BIRTHDAY_AGE_GROUPS,
  BIRTHDAY_AUDIENCES,
  CATEGORY_KEYS,
  COMMUNITY_ENTRY,
  COMMUNITY_FORMATS,
  COMMUNITY_SETTINGS,
  CURRENCIES,
  DIETARY_KEYS,
  EVENT_TYPES,
  MAX_BUDGET,
  MAX_GUESTS,
  PRIORITY_KEYS,
  TASK_AREAS,
  TASK_PRIORITIES,
  VENUE_STATUSES,
  WEDDING_FUNCTIONS,
} from './constants';
import { isISODate } from './dates';
import { cleanText } from './text';
import { VENDOR_KEYS } from './vendorCatalog';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Untrusted single-line text: cleaned, then length-checked. */
export const text = (max: number, min = 0) =>
  z
    .string()
    .transform((value) => cleanText(value))
    .pipe(
      z
        .string()
        .min(min, min === 1 ? 'This field is required.' : `Use at least ${min} characters.`)
        .max(max, `Keep this under ${max} characters.`),
    );

export const multilineText = (max: number) =>
  z
    .string()
    .transform((value) => cleanText(value, { multiline: true }))
    .pipe(z.string().max(max, `Keep this under ${max} characters.`));

export const isoDate = z
  .string()
  .refine(isISODate, 'Use a valid date in YYYY-MM-DD format.');

const uniqueArray = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(50)
    .transform((values) => [...new Set(values)] as z.output<T>[])
    .refine((values) => values.length <= max, `Choose up to ${max}.`);

/* ------------------------------------------------------------------ */
/* Event input (what the user tells us)                                 */
/* ------------------------------------------------------------------ */

export const WeddingDetailsSchema = z.object({
  functions: uniqueArray(z.enum(WEDDING_FUNCTIONS), WEDDING_FUNCTIONS.length).refine(
    (values) => values.length > 0,
    'Choose at least one function.',
  ),
  days: z.number().int().min(1, 'At least one day.').max(7, 'Plan up to seven days.'),
});

export const BirthdayDetailsSchema = z.object({
  ageGroup: z.enum(BIRTHDAY_AGE_GROUPS),
  audience: z.enum(BIRTHDAY_AUDIENCES),
  honoreeName: text(40).optional().default(''),
});

export const CommunityDetailsSchema = z.object({
  format: z.enum(COMMUNITY_FORMATS),
  setting: z.enum(COMMUNITY_SETTINGS),
  entry: z.enum(COMMUNITY_ENTRY),
});

export const EventInputSchema = z
  .object({
    eventType: z.enum(EVENT_TYPES),
    title: text(80).optional().default(''),
    eventDate: isoDate,
    guestCount: z
      .number({ error: 'Enter the number of guests.' })
      .int('Use a whole number of guests.')
      .min(1, 'There must be at least one guest.')
      .max(MAX_GUESTS, `Utsav plans events of up to ${MAX_GUESTS.toLocaleString('en-IN')} guests.`),
    totalBudget: z
      .number({ error: 'Enter a total budget.' })
      .finite()
      .positive('The budget must be more than zero.')
      .max(MAX_BUDGET, 'That budget is too large to plan reliably.'),
    currency: z.enum(CURRENCIES),
    city: text(80, 2),
    style: text(120, 2),
    priorities: uniqueArray(z.enum(PRIORITY_KEYS), 3),
    dietary: uniqueArray(z.enum(DIETARY_KEYS), DIETARY_KEYS.length).default([]),
    accessibility: uniqueArray(z.enum(ACCESSIBILITY_KEYS), ACCESSIBILITY_KEYS.length).default([]),
    culturalNotes: multilineText(300).optional().default(''),
    notes: multilineText(500).optional().default(''),
    venueStatus: z.enum(VENUE_STATUSES),
    wedding: WeddingDetailsSchema.optional(),
    birthday: BirthdayDetailsSchema.optional(),
    community: CommunityDetailsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.eventType === 'wedding' && !input.wedding) {
      ctx.addIssue({ code: 'custom', path: ['wedding'], message: 'Tell us which wedding functions to plan.' });
    }
    if (input.eventType === 'birthday' && !input.birthday) {
      ctx.addIssue({ code: 'custom', path: ['birthday'], message: 'Tell us who the birthday is for.' });
    }
    if (input.eventType === 'community' && !input.community) {
      ctx.addIssue({ code: 'custom', path: ['community'], message: 'Tell us about the event format.' });
    }
  })
  .transform((input) => ({
    ...input,
    // Keep only the details that belong to the chosen event type.
    wedding: input.eventType === 'wedding' ? input.wedding : undefined,
    birthday: input.eventType === 'birthday' ? input.birthday : undefined,
    community: input.eventType === 'community' ? input.community : undefined,
  }));

export type EventInput = z.output<typeof EventInputSchema>;
export type EventInputDraft = z.input<typeof EventInputSchema>;

/* ------------------------------------------------------------------ */
/* What the AI returns                                                  */
/* ------------------------------------------------------------------ */

const aiText = (max: number) => z.string().transform((value) => cleanText(value).slice(0, max));
const aiList = (max: number, maxItems: number) =>
  z
    .array(aiText(max))
    .transform((values) => values.filter(Boolean).slice(0, maxItems));

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

/* ------------------------------------------------------------------ */
/* The saved plan                                                       */
/* ------------------------------------------------------------------ */

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

export const PlanMetaSchema = z.object({
  source: z.enum(['ai', 'sample']),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string(),
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

/* ------------------------------------------------------------------ */
/* API requests                                                         */
/* ------------------------------------------------------------------ */

export const GenerateRequestSchema = z.object({
  input: EventInputSchema,
  clientToday: isoDate,
});

export const ReviseRequestSchema = z.object({
  plan: PlanSchema,
  request: text(500, 3),
  clientToday: isoDate,
});
