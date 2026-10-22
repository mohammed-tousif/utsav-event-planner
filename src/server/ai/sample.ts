import { categoriesFor, type CategoryKey } from '../../shared/constants';
import type { AiPlanDraft, AiRevision, EventInput, Plan } from '../../shared/schemas';
import { parseIntent } from '../../shared/revision';
import { vendorTemplatesFor } from '../../shared/vendorCatalog';
import type { AiProvider, AiResult } from './types';

/**
 * Fixed sample content for local development and automated tests when no
 * Gemini key is configured. It is NOT generative AI: the app labels every
 * plan it produces as "Sample data" and production refuses to use it unless
 * AI_PROVIDER=sample is set explicitly.
 */

const TASKS: Record<EventInput['eventType'], AiPlanDraft['tasks']> = {
  wedding: [
    { title: 'Fix the wedding dates with both families', area: 'other', offsetDays: 200, priority: 'high', notes: 'Check auspicious dates and key relatives’ availability.' },
    { title: 'Book the venue for all functions', area: 'venue', offsetDays: 180, priority: 'high', notes: 'Confirm setup time and power backup.' },
    { title: 'Shortlist and book the caterer', area: 'food', offsetDays: 150, priority: 'high', notes: 'Arrange a tasting before paying the advance.' },
    { title: 'Book photographer and videographer', area: 'vendors', offsetDays: 150, priority: 'high', notes: '' },
    { title: 'Finalise decor concept and decorator', area: 'decor', offsetDays: 120, priority: 'medium', notes: '' },
    { title: 'Draft the guest list', area: 'guests', offsetDays: 110, priority: 'high', notes: '' },
    { title: 'Order outfits and plan fittings', area: 'attire', offsetDays: 90, priority: 'medium', notes: '' },
    { title: 'Book makeup and mehendi artists', area: 'vendors', offsetDays: 90, priority: 'medium', notes: '' },
    { title: 'Send invitations', area: 'guests', offsetDays: 45, priority: 'high', notes: '' },
    { title: 'Arrange guest transport and stay', area: 'logistics', offsetDays: 40, priority: 'medium', notes: '' },
    { title: 'Confirm rituals and items with the priest', area: 'ceremony', offsetDays: 30, priority: 'medium', notes: '' },
    { title: 'Final headcount to the caterer', area: 'food', offsetDays: 7, priority: 'high', notes: '' },
    { title: 'Share the run sheet with every vendor', area: 'vendors', offsetDays: 3, priority: 'high', notes: '' },
    { title: 'Pack the emergency kit', area: 'other', offsetDays: 1, priority: 'low', notes: 'Safety pins, medicines, chargers, cash.' },
  ],
  birthday: [
    { title: 'Pick the venue and book it', area: 'venue', offsetDays: 30, priority: 'high', notes: '' },
    { title: 'Make the guest list', area: 'guests', offsetDays: 28, priority: 'high', notes: '' },
    { title: 'Send invitations', area: 'guests', offsetDays: 21, priority: 'high', notes: '' },
    { title: 'Book the entertainer or plan games', area: 'vendors', offsetDays: 21, priority: 'medium', notes: '' },
    { title: 'Fix the menu with the caterer', area: 'food', offsetDays: 14, priority: 'high', notes: '' },
    { title: 'Order the cake', area: 'food', offsetDays: 7, priority: 'high', notes: '' },
    { title: 'Buy return gifts', area: 'other', offsetDays: 7, priority: 'low', notes: '' },
    { title: 'Confirm RSVPs and final count', area: 'guests', offsetDays: 3, priority: 'medium', notes: '' },
    { title: 'Set up decorations', area: 'decor', offsetDays: 0, priority: 'medium', notes: '' },
  ],
  community: [
    { title: 'Form the organising committee and assign roles', area: 'other', offsetDays: 75, priority: 'high', notes: '' },
    { title: 'Book the ground or hall', area: 'venue', offsetDays: 60, priority: 'high', notes: '' },
    { title: 'Apply for police and municipal permissions', area: 'paperwork', offsetDays: 45, priority: 'high', notes: '' },
    { title: 'Book sound, stage and lights', area: 'vendors', offsetDays: 30, priority: 'high', notes: '' },
    { title: 'Recruit and brief volunteers', area: 'logistics', offsetDays: 21, priority: 'medium', notes: '' },
    { title: 'Start publicity in the neighbourhood', area: 'guests', offsetDays: 21, priority: 'medium', notes: '' },
    { title: 'Arrange sanitation, water and first aid', area: 'logistics', offsetDays: 14, priority: 'high', notes: '' },
    { title: 'Confirm food stalls', area: 'food', offsetDays: 10, priority: 'medium', notes: '' },
    { title: 'Walk through the site and plan crowd flow', area: 'logistics', offsetDays: 2, priority: 'high', notes: '' },
  ],
};

const SCHEDULE: Record<EventInput['eventType'], AiPlanDraft['schedule']> = {
  wedding: [
    { segment: 'Wedding day', time: '07:00', durationMin: 120, title: 'Bride and groom getting ready', notes: '' },
    { segment: 'Wedding day', time: '09:30', durationMin: 60, title: 'Baraat and welcome', notes: '' },
    { segment: 'Wedding day', time: '10:30', durationMin: 120, title: 'Wedding ceremony', notes: '' },
    { segment: 'Wedding day', time: '12:30', durationMin: 120, title: 'Lunch for guests', notes: '' },
    { segment: 'Reception', time: '19:00', durationMin: 60, title: 'Couple’s entry and photos', notes: '' },
    { segment: 'Reception', time: '20:00', durationMin: 120, title: 'Dinner and music', notes: '' },
  ],
  birthday: [
    { segment: 'Party', time: '16:00', durationMin: 30, title: 'Guests arrive, welcome drinks', notes: '' },
    { segment: 'Party', time: '16:30', durationMin: 45, title: 'Games or entertainer', notes: '' },
    { segment: 'Party', time: '17:15', durationMin: 20, title: 'Cake cutting', notes: '' },
    { segment: 'Party', time: '17:35', durationMin: 45, title: 'Food', notes: '' },
    { segment: 'Party', time: '18:20', durationMin: 20, title: 'Return gifts and goodbyes', notes: '' },
  ],
  community: [
    { segment: 'Event day', time: '07:00', durationMin: 120, title: 'Setup and safety check', notes: '' },
    { segment: 'Event day', time: '09:00', durationMin: 30, title: 'Opening and welcome', notes: '' },
    { segment: 'Event day', time: '09:30', durationMin: 180, title: 'Main programme', notes: '' },
    { segment: 'Event day', time: '12:30', durationMin: 90, title: 'Food and break', notes: '' },
    { segment: 'Event day', time: '14:00', durationMin: 60, title: 'Closing and clean-up', notes: '' },
  ],
};

function ideas(input: EventInput): AiPlanDraft['ideas'] {
  const decor: CategoryKey = 'decor';
  const food: CategoryKey = 'catering';
  return [
    { title: 'Sample idea: theme colour palette', description: `A simple palette drawn from “${input.style}” used across decor and invites.`, whyItFits: 'Placeholder text from sample data.', estimatedCost: Math.round(input.totalBudget * 0.01), budgetCategory: decor, effort: 'low' },
    { title: 'Sample idea: local specialty counter', description: `One live counter featuring a dish from ${input.city}.`, whyItFits: 'Placeholder text from sample data.', estimatedCost: Math.round(input.totalBudget * 0.03), budgetCategory: food, effort: 'medium' },
    { title: 'Sample idea: memory wall', description: 'A wall of printed photos guests can add notes to.', whyItFits: 'Placeholder text from sample data.', estimatedCost: Math.round(input.totalBudget * 0.005), budgetCategory: decor, effort: 'low' },
  ];
}

export function sampleDraft(input: EventInput): AiPlanDraft {
  return {
    summary: 'Sample data for development. Connect a Gemini API key to generate a personalised plan.',
    contingencyPct: 0,
    adjustments: [],
    tradeoffs: [],
    tasks: TASKS[input.eventType],
    schedule: SCHEDULE[input.eventType],
    vendors: vendorTemplatesFor(input.eventType).map((v) => ({
      category: v.key,
      why: '',
      questions: v.questions,
      compareOn: v.compareOn,
      redFlags: [],
    })),
    ideas: ideas(input),
    assumptions: ['This plan uses fixed sample content, not AI.'],
  };
}

/** Keyword-only revision so the UI flow can be exercised without AI. */
export function sampleRevision(plan: Plan, request: string): AiRevision {
  const intent = parseIntent(request, plan.input);
  const text = request.toLowerCase();
  const allowed = new Set(categoriesFor(plan.input.eventType));
  const lock: CategoryKey[] = [];
  const adjustments: AiRevision['adjustments'] = [];
  if (/keep .*venue|venue .*(unchanged|same)/.test(text) && allowed.has('venue')) lock.push('venue');
  if (/(reduce|cut|less|lower).{0,30}decor/.test(text) && allowed.has('decor')) {
    adjustments.push({ category: 'decor', factor: 0.7, reason: 'Sample rule: decoration reduced as requested.' });
  }
  return {
    understood: `Sample data: applied simple rules to “${request}”.`,
    totalBudget: intent.totalBudget ?? plan.input.totalBudget,
    guestCount: intent.guestCount ?? plan.input.guestCount,
    eventDate: plan.input.eventDate,
    style: plan.input.style,
    lockCategories: lock,
    unlockCategories: [],
    adjustments,
    regenerateTasks: false,
    regenerateSchedule: false,
    regenerateVendors: false,
    regenerateIdeas: false,
    tasks: [],
    schedule: [],
    vendors: [],
    ideas: [],
    changeSummary: ['Sample data: numbers recalculated by the app. No AI was used.'],
    tradeoffs: [],
  };
}

export class SampleProvider implements AiProvider {
  readonly name = 'sample' as const;
  readonly model = 'sample-data';
  readonly configured = true;

  async generatePlan(input: EventInput): Promise<AiResult<AiPlanDraft>> {
    return { data: sampleDraft(input), model: this.model };
  }

  async revisePlan(plan: Plan, request: string): Promise<AiResult<AiRevision>> {
    return { data: sampleRevision(plan, request), model: this.model };
  }
}
