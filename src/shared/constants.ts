/**
 * Static domain knowledge used by both the server and the browser.
 * Nothing in here comes from the AI: these are the deterministic rules the
 * app uses to check, scale and complete whatever the model suggests.
 */

export const EVENT_TYPES = ['wedding', 'birthday', 'community'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  community: 'Community event',
};

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PRIORITY_KEYS = [
  'food',
  'venue',
  'decor',
  'photography',
  'entertainment',
  'guest_comfort',
  'attire',
  'rituals',
  'keepsakes',
] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];

export const PRIORITY_LABELS: Record<PriorityKey, string> = {
  food: 'Food and drinks',
  venue: 'Venue',
  decor: 'Decor',
  photography: 'Photos and video',
  entertainment: 'Music and entertainment',
  guest_comfort: 'Guest comfort and logistics',
  attire: 'Outfits and styling',
  rituals: 'Rituals and ceremonies',
  keepsakes: 'Invites, favours and keepsakes',
};

export const DIETARY_KEYS = [
  'vegetarian',
  'jain',
  'vegan',
  'non_vegetarian',
  'halal',
  'gluten_free',
  'nut_free',
] as const;
export type DietaryKey = (typeof DIETARY_KEYS)[number];

export const DIETARY_LABELS: Record<DietaryKey, string> = {
  vegetarian: 'Vegetarian',
  jain: 'Jain',
  vegan: 'Vegan',
  non_vegetarian: 'Non-vegetarian',
  halal: 'Halal',
  gluten_free: 'Gluten-free',
  nut_free: 'Nut-free',
};

export const ACCESSIBILITY_KEYS = [
  'wheelchair_access',
  'elderly_guests',
  'young_children',
  'hearing_support',
  'low_sensory',
  'accessible_restrooms',
] as const;
export type AccessibilityKey = (typeof ACCESSIBILITY_KEYS)[number];

export const ACCESSIBILITY_LABELS: Record<AccessibilityKey, string> = {
  wheelchair_access: 'Step-free or wheelchair access',
  elderly_guests: 'Many elderly guests',
  young_children: 'Many young children',
  hearing_support: 'Hearing support',
  low_sensory: 'Quiet or low-sensory space',
  accessible_restrooms: 'Accessible restrooms',
};

/* ------------------------------------------------------------------ */
/* Budget categories                                                    */
/* ------------------------------------------------------------------ */

export const CATEGORY_KEYS = [
  'venue',
  'catering',
  'cake',
  'decor',
  'photo_video',
  'attire_beauty',
  'invitations',
  'entertainment',
  'ceremony',
  'transport_stay',
  'gifts_favors',
  'sound_light',
  'permits_safety',
  'publicity',
  'logistics_volunteers',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface CategoryMeta {
  label: string;
  /**
   * How strongly the category scales with guest count. 1 = linear (food per
   * plate), 0 = flat (a priest's fee does not depend on headcount).
   */
  guestExponent: number;
  /** Priorities that justify extra weight for this category. */
  boostedBy: readonly PriorityKey[];
}

export const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  venue: { label: 'Venue', guestExponent: 0.5, boostedBy: ['venue', 'guest_comfort'] },
  catering: { label: 'Food and drinks', guestExponent: 1, boostedBy: ['food'] },
  cake: { label: 'Cake and desserts', guestExponent: 0.6, boostedBy: ['food'] },
  decor: { label: 'Decor and lighting', guestExponent: 0.35, boostedBy: ['decor'] },
  photo_video: { label: 'Photos and video', guestExponent: 0.15, boostedBy: ['photography'] },
  attire_beauty: { label: 'Outfits, makeup and mehendi', guestExponent: 0, boostedBy: ['attire'] },
  invitations: { label: 'Invitations', guestExponent: 0.8, boostedBy: ['keepsakes'] },
  entertainment: { label: 'Music and entertainment', guestExponent: 0.25, boostedBy: ['entertainment'] },
  ceremony: { label: 'Rituals and ceremony', guestExponent: 0, boostedBy: ['rituals'] },
  transport_stay: { label: 'Guest transport and stay', guestExponent: 0.9, boostedBy: ['guest_comfort'] },
  gifts_favors: { label: 'Favours and return gifts', guestExponent: 1, boostedBy: ['keepsakes'] },
  sound_light: { label: 'Sound, stage and lights', guestExponent: 0.35, boostedBy: ['entertainment'] },
  permits_safety: { label: 'Permits, security and first aid', guestExponent: 0.4, boostedBy: ['guest_comfort'] },
  publicity: { label: 'Publicity and printing', guestExponent: 0.2, boostedBy: ['keepsakes'] },
  logistics_volunteers: {
    label: 'Logistics, sanitation and volunteers',
    guestExponent: 0.6,
    boostedBy: ['guest_comfort'],
  },
};

export interface EventTypeConfig {
  /** Guest count the base weights were calibrated for. */
  referenceGuests: number;
  /** Relative weights for a typical event of this type (need not sum to 100). */
  baseWeights: Partial<Record<CategoryKey, number>>;
  defaultContingencyPct: number;
}

export const EVENT_CONFIG: Record<EventType, EventTypeConfig> = {
  wedding: {
    referenceGuests: 200,
    baseWeights: {
      venue: 22,
      catering: 30,
      decor: 11,
      photo_video: 9,
      attire_beauty: 10,
      invitations: 3,
      entertainment: 5,
      ceremony: 3,
      transport_stay: 4,
      gifts_favors: 3,
    },
    defaultContingencyPct: 8,
  },
  birthday: {
    referenceGuests: 40,
    baseWeights: {
      venue: 22,
      catering: 34,
      cake: 8,
      decor: 14,
      entertainment: 10,
      photo_video: 6,
      gifts_favors: 6,
    },
    defaultContingencyPct: 7,
  },
  community: {
    referenceGuests: 150,
    baseWeights: {
      venue: 16,
      catering: 22,
      sound_light: 18,
      decor: 10,
      permits_safety: 10,
      logistics_volunteers: 10,
      publicity: 6,
      entertainment: 8,
    },
    defaultContingencyPct: 10,
  },
};

export function categoriesFor(eventType: EventType): CategoryKey[] {
  return CATEGORY_KEYS.filter((key) => EVENT_CONFIG[eventType].baseWeights[key] !== undefined);
}

/* ------------------------------------------------------------------ */
/* Event-type specifics (asked as follow-up questions)                  */
/* ------------------------------------------------------------------ */

export const WEDDING_FUNCTIONS = ['engagement', 'mehendi', 'haldi', 'sangeet', 'ceremony', 'reception'] as const;
export type WeddingFunction = (typeof WEDDING_FUNCTIONS)[number];
export const WEDDING_FUNCTION_LABELS: Record<WeddingFunction, string> = {
  engagement: 'Engagement',
  mehendi: 'Mehendi',
  haldi: 'Haldi',
  sangeet: 'Sangeet',
  ceremony: 'Wedding ceremony',
  reception: 'Reception',
};

export const BIRTHDAY_AGE_GROUPS = ['child', 'teen', 'adult', 'milestone'] as const;
export type BirthdayAgeGroup = (typeof BIRTHDAY_AGE_GROUPS)[number];
export const BIRTHDAY_AGE_LABELS: Record<BirthdayAgeGroup, string> = {
  child: 'Child (1–12)',
  teen: 'Teen (13–19)',
  adult: 'Adult',
  milestone: 'Milestone (50th, 60th, 75th…)',
};

export const BIRTHDAY_AUDIENCES = ['kids', 'adults', 'mixed'] as const;
export type BirthdayAudience = (typeof BIRTHDAY_AUDIENCES)[number];
export const BIRTHDAY_AUDIENCE_LABELS: Record<BirthdayAudience, string> = {
  kids: 'Mostly children',
  adults: 'Mostly adults',
  mixed: 'Families, all ages',
};

export const COMMUNITY_FORMATS = ['festival', 'cultural_program', 'fundraiser', 'sports_day', 'meetup'] as const;
export type CommunityFormat = (typeof COMMUNITY_FORMATS)[number];
export const COMMUNITY_FORMAT_LABELS: Record<CommunityFormat, string> = {
  festival: 'Festival celebration',
  cultural_program: 'Cultural programme',
  fundraiser: 'Fundraiser or charity drive',
  sports_day: 'Sports day',
  meetup: 'Neighbourhood or society meetup',
};

export const COMMUNITY_SETTINGS = ['indoor', 'outdoor', 'mixed'] as const;
export type CommunitySetting = (typeof COMMUNITY_SETTINGS)[number];
export const COMMUNITY_SETTING_LABELS: Record<CommunitySetting, string> = {
  indoor: 'Indoors',
  outdoor: 'Outdoors',
  mixed: 'Indoors and outdoors',
};

export const COMMUNITY_ENTRY = ['free', 'ticketed', 'donation'] as const;
export type CommunityEntry = (typeof COMMUNITY_ENTRY)[number];
export const COMMUNITY_ENTRY_LABELS: Record<CommunityEntry, string> = {
  free: 'Free entry',
  ticketed: 'Ticketed',
  donation: 'Donation-based',
};

export const VENUE_STATUSES = ['booked', 'shortlisted', 'not_started'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];
export const VENUE_STATUS_LABELS: Record<VenueStatus, string> = {
  booked: 'Already booked',
  shortlisted: 'Shortlisted, not booked',
  not_started: 'Not started',
};

/* ------------------------------------------------------------------ */
/* Timeline                                                             */
/* ------------------------------------------------------------------ */

export const TASK_AREAS = [
  'venue',
  'food',
  'decor',
  'guests',
  'vendors',
  'attire',
  'logistics',
  'paperwork',
  'ceremony',
  'other',
] as const;
export type TaskArea = (typeof TASK_AREAS)[number];

export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Events further out than this are rejected: plans would be guesswork. */
export const MAX_DAYS_AHEAD = 1095;
export const MAX_GUESTS = 5000;
export const MAX_BUDGET = 10_000_000_000;
