/** What the user tells us about the event. */
import { z } from 'zod';
import {
  ACCESSIBILITY_KEYS,
  BIRTHDAY_AGE_GROUPS,
  BIRTHDAY_AUDIENCES,
  COMMUNITY_ENTRY,
  COMMUNITY_FORMATS,
  COMMUNITY_SETTINGS,
  CURRENCIES,
  DIETARY_KEYS,
  EVENT_TYPES,
  MAX_BUDGET,
  MAX_GUESTS,
  PRIORITY_KEYS,
  VENUE_STATUSES,
  WEDDING_FUNCTIONS,
} from '../constants';
import { isoDate, multilineText, text, uniqueArray } from './fields';

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
