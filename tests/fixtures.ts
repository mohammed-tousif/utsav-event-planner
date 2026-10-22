import { sampleDraft } from '../src/server/ai/sample';
import { assemblePlan } from '../src/shared/plan';
import { EventInputSchema, type AiRevision, type EventInput, type EventInputDraft, type Plan } from '../src/shared/schemas';

export const TODAY = '2026-10-22';

export function makeInput(overrides: Partial<EventInputDraft> = {}): EventInput {
  return EventInputSchema.parse({
    eventType: 'wedding',
    title: 'Asha and Rohan’s wedding',
    eventDate: '2027-02-14',
    guestCount: 250,
    totalBudget: 1_500_000,
    currency: 'INR',
    city: 'Hubballi, Karnataka',
    style: 'Pastel garden with marigold accents',
    priorities: ['food', 'photography'],
    dietary: ['vegetarian', 'jain'],
    accessibility: ['elderly_guests'],
    venueStatus: 'shortlisted',
    wedding: { functions: ['mehendi', 'ceremony', 'reception'], days: 2 },
    ...overrides,
  });
}

export function makePlan(input: EventInput = makeInput(), today = TODAY): Plan {
  return assemblePlan(
    input,
    sampleDraft(input),
    { source: 'sample', provider: 'Sample data', model: 'sample-data', generatedAt: '2026-10-22T10:00:00.000Z' },
    today,
  );
}

/** A revision that changes nothing unless overridden. */
export function makeRevision(plan: Plan, overrides: Partial<AiRevision> = {}): AiRevision {
  return {
    understood: 'Test revision.',
    totalBudget: plan.input.totalBudget,
    guestCount: plan.input.guestCount,
    eventDate: plan.input.eventDate,
    style: plan.input.style,
    lockCategories: [],
    unlockCategories: [],
    adjustments: [],
    regenerateTasks: false,
    regenerateSchedule: false,
    regenerateVendors: false,
    regenerateIdeas: false,
    tasks: [],
    schedule: [],
    vendors: [],
    ideas: [],
    changeSummary: [],
    tradeoffs: [],
    ...overrides,
  };
}

export function budgetSum(plan: Pick<Plan, 'budget'>): number {
  return plan.budget.lines.reduce((sum, line) => sum + line.amount, 0) + plan.budget.contingency;
}
