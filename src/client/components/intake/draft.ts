import {
  MAX_DAYS_AHEAD,
  type BirthdayAgeGroup,
  type BirthdayAudience,
  type CommunityEntry,
  type CommunityFormat,
  type CommunitySetting,
  type Currency,
  type EventType,
  type VenueStatus,
  type WeddingFunction,
} from '../../../shared/constants';
import { daysBetween, isISODate } from '../../../shared/dates';
import { EventInputSchema, type EventInput } from '../../../shared/schemas';

/** The form as typed: strings for numbers so partial input is never lost. Saved as a draft between visits. */
export interface Draft {
  eventType: EventType | '';
  title: string;
  eventDate: string;
  guestCount: string;
  totalBudget: string;
  currency: Currency;
  city: string;
  style: string;
  priorities: string[];
  dietary: string[];
  accessibility: string[];
  culturalNotes: string;
  notes: string;
  venueStatus: VenueStatus | '';
  weddingFunctions: WeddingFunction[];
  weddingDays: string;
  ageGroup: BirthdayAgeGroup | '';
  audience: BirthdayAudience | '';
  honoreeName: string;
  format: CommunityFormat | '';
  setting: CommunitySetting | '';
  entry: CommunityEntry | '';
}

export type Errors = Record<string, string>;

export const EMPTY_DRAFT: Draft = {
  eventType: '',
  title: '',
  eventDate: '',
  guestCount: '',
  totalBudget: '',
  currency: 'INR',
  city: '',
  style: '',
  priorities: [],
  dietary: [],
  accessibility: [],
  culturalNotes: '',
  notes: '',
  venueStatus: '',
  weddingFunctions: ['ceremony', 'reception'],
  weddingDays: '1',
  ageGroup: '',
  audience: '',
  honoreeName: '',
  format: '',
  setting: '',
  entry: '',
};

export const STEPS = ['basics', 'budget', 'details', 'preferences', 'review'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_TITLES: Record<Step, string> = {
  basics: 'The basics',
  budget: 'Budget and priorities',
  details: 'A few questions about this event',
  preferences: 'Style and preferences',
  review: 'Check and create',
};

/** Which form fields each step owns, for showing errors on the right step. */
const STEP_FIELDS: Record<Step, string[]> = {
  basics: ['eventType', 'eventDate', 'guestCount', 'city', 'venueStatus', 'title'],
  budget: ['totalBudget', 'currency', 'priorities'],
  details: ['wedding', 'birthday', 'community'],
  preferences: ['style', 'dietary', 'accessibility', 'culturalNotes', 'notes'],
  review: [],
};

export const numberFrom = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value.replace(/[,\s_]/g, '')));

/** A positive number typed into the form, or undefined. */
export function positiveNumber(value: string): number | undefined {
  const n = numberFrom(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function typeDetails(draft: Draft) {
  const { eventType } = draft;
  return {
    wedding: eventType === 'wedding' ? { functions: draft.weddingFunctions, days: numberFrom(draft.weddingDays) } : undefined,
    birthday:
      eventType === 'birthday' && draft.ageGroup && draft.audience
        ? { ageGroup: draft.ageGroup, audience: draft.audience, honoreeName: draft.honoreeName }
        : undefined,
    community:
      eventType === 'community' && draft.format && draft.setting && draft.entry
        ? { format: draft.format, setting: draft.setting, entry: draft.entry }
        : undefined,
  };
}

/** The draft in the shape the shared EventInput schema expects. */
export function toInput(draft: Draft) {
  return {
    eventType: draft.eventType || undefined,
    title: draft.title,
    eventDate: draft.eventDate,
    guestCount: numberFrom(draft.guestCount),
    totalBudget: numberFrom(draft.totalBudget),
    currency: draft.currency,
    city: draft.city,
    style: draft.style,
    priorities: draft.priorities,
    dietary: draft.dietary,
    accessibility: draft.accessibility,
    culturalNotes: draft.culturalNotes,
    notes: draft.notes,
    venueStatus: draft.venueStatus || undefined,
    ...typeDetails(draft),
  };
}

const NUMBER_MESSAGES: Record<string, string> = {
  guestCount: 'Enter the number of guests.',
  totalBudget: 'Enter a total budget as a number.',
};

function friendlyMessage(field: string, message: string): string {
  if (/expected number, received NaN|Invalid input: expected number/i.test(message)) return NUMBER_MESSAGES[field] ?? 'Enter a number.';
  if (/expected string, received undefined|Invalid option/i.test(message)) return 'Choose one.';
  return message;
}

function dateError(eventDate: string, today: string): string | undefined {
  if (!eventDate) return 'Choose the event date.';
  if (!isISODate(eventDate)) return undefined;
  const days = daysBetween(today, eventDate);
  if (days < 0) return 'That date has passed. Choose today or a later date.';
  if (days > MAX_DAYS_AHEAD) return 'Choose a date within the next three years.';
  return undefined;
}

/** Checks that need a friendlier message than the schema would give. */
function formErrors(draft: Draft, today: string): Errors {
  const errors: Errors = {};
  const date = dateError(draft.eventDate, today);
  if (date) errors.eventDate = date;
  if (draft.eventType === 'birthday' && (!draft.ageGroup || !draft.audience)) {
    errors.birthday = 'Tell us who the birthday is for and who is coming.';
  }
  if (draft.eventType === 'community' && (!draft.format || !draft.setting || !draft.entry)) {
    errors.community = 'Answer all three questions about the event.';
  }
  return errors;
}

/** Validates the draft with the same schema the server uses. Earlier, friendlier messages win. */
export function validate(draft: Draft, today: string): { input?: EventInput; errors: Errors } {
  const errors = formErrors(draft, today);
  const parsed = EventInputSchema.safeParse(toInput(draft));
  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const top = String(issue.path[0] ?? 'form');
    const nested = ['wedding', 'birthday', 'community'].includes(top);
    const field = nested ? issue.path.join('.') : top;
    errors[field] ??= friendlyMessage(top, issue.message);
  }
  if (draft.priorities.length === 0) errors.priorities = 'Pick at least one thing that matters most.';
  return { input: parsed.success && Object.keys(errors).length === 0 ? parsed.data : undefined, errors };
}

export function errorsForStep(step: Step, errors: Errors): Errors {
  const owned = STEP_FIELDS[step];
  return Object.fromEntries(Object.entries(errors).filter(([key]) => owned.some((f) => key === f || key.startsWith(`${f}.`))));
}

export function stepsWithErrors(errors: Errors): Step[] {
  return STEPS.filter((step) => Object.keys(errorsForStep(step, errors)).length > 0);
}
