import { daysBetween } from './dates';
import { formatMoney } from './money';
import type { EventInput } from './schemas';

export interface IntakeCheck {
  code: string;
  level: 'info' | 'warn';
  message: string;
}

const TIGHT_PER_GUEST_INR = { wedding: 1200, birthday: 450, community: 120 } as const;

interface CheckContext {
  input: EventInput;
  days: number;
  perGuest: number;
}

type Check = (ctx: CheckContext) => IntakeCheck | undefined;

const shortNotice: Check = ({ days }) => {
  if (days < 0 || days > 7) return undefined;
  return {
    code: 'short_notice',
    level: 'warn',
    message:
      days === 0
        ? 'The event is today. The plan will focus on the event-day schedule and anything still urgent.'
        : `The event is ${days} day${days === 1 ? '' : 's'} away. Tasks will be compressed into the time left.`,
  };
};

const venueFirst: Check = ({ input, days }) =>
  input.venueStatus === 'not_started' && days <= 30
    ? { code: 'venue_first', level: 'warn', message: 'With no venue yet and a month or less to go, book the venue before anything else.' }
    : undefined;

const tightBudget: Check = ({ input, perGuest }) =>
  input.currency === 'INR' && perGuest < TIGHT_PER_GUEST_INR[input.eventType]
    ? {
        code: 'tight_budget',
        level: 'warn',
        message: `${formatMoney(input.totalBudget, 'INR')} for ${input.guestCount} guests is about ${formatMoney(perGuest, 'INR')} each, which is tight. The plan will suggest where to save.`,
      }
    : undefined;

const highBudget: Check = ({ input, perGuest }) =>
  input.currency === 'INR' && perGuest > 500_000
    ? { code: 'high_budget', level: 'info', message: 'That is more than ₹5,00,000 per guest. Check the budget for an extra zero.' }
    : undefined;

const largeBirthday: Check = ({ input }) =>
  input.eventType === 'birthday' && input.guestCount > 500
    ? { code: 'large_birthday', level: 'info', message: 'More than 500 guests is unusually large for a birthday. Check the guest count.' }
    : undefined;

const packedDays: Check = ({ input }) => {
  const wedding = input.eventType === 'wedding' ? input.wedding : undefined;
  return wedding && wedding.functions.length > wedding.days * 3
    ? {
        code: 'packed_days',
        level: 'info',
        message: 'That is more than three functions a day. Consider adding a day or combining functions.',
      }
    : undefined;
};

const CHECKS: readonly Check[] = [shortNotice, venueFirst, tightBudget, highBudget, largeBirthday, packedDays];

/**
 * Plausibility checks shown before generating a plan. They never block:
 * the user can confirm and continue, but they see what looks unusual.
 */
export function intakeChecks(input: EventInput, today: string): IntakeCheck[] {
  const ctx: CheckContext = { input, days: daysBetween(today, input.eventDate), perGuest: input.totalBudget / input.guestCount };
  return CHECKS.map((check) => check(ctx)).filter((check): check is IntakeCheck => check !== undefined);
}
