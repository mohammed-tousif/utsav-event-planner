import type { CategoryKey, EventType } from './constants';

export const VENDOR_KEYS = [
  'venue',
  'caterer',
  'decorator',
  'photographer',
  'makeup_mehendi',
  'officiant',
  'music',
  'invitations_print',
  'transport',
  'cake_baker',
  'entertainer',
  'return_gifts',
  'permits',
  'sound_light',
  'tent_pandal',
  'security_firstaid',
  'sanitation',
  'publicity_print',
] as const;
export type VendorKey = (typeof VENDOR_KEYS)[number];

export interface VendorTemplate {
  key: VendorKey;
  label: string;
  /** Typical booking lead time: book at least this many days before. */
  leadDays: number;
  budgetCategory: CategoryKey;
  questions: string[];
  compareOn: string[];
}

const T = (
  key: VendorKey,
  label: string,
  leadDays: number,
  budgetCategory: CategoryKey,
  questions: string[],
  compareOn: string[],
): VendorTemplate => ({ key, label, leadDays, budgetCategory, questions, compareOn });

/**
 * Standard checklist per event type. The AI tailors the reasons and questions,
 * but every category listed here always appears so the checklist is complete
 * even if the model leaves one out.
 */
export const VENDOR_CATALOG: Record<EventType, VendorTemplate[]> = {
  wedding: [
    T('venue', 'Venue', 180, 'venue',
      ['Is the date available for every function, including setup time?', 'What is included: chairs, generator backup, parking, rooms?', 'Can we bring outside caterers and decorators?'],
      ['Capacity for your guest count', 'Total cost including taxes', 'Cancellation terms']),
    T('caterer', 'Caterer', 150, 'catering',
      ['What is the per-plate price for your menu and minimum plates?', 'Can you cater separately for Jain, vegan or allergy needs?', 'Is a tasting session included?'],
      ['Per-plate price', 'Menu flexibility', 'Staff per 100 guests']),
    T('decorator', 'Decorator', 120, 'decor',
      ['Can you share photos of setups at this budget?', 'Is lighting and mandap or stage included?', 'How long do setup and teardown take?'],
      ['Package inclusions', 'Fresh vs artificial flowers', 'Past work in your style']),
    T('photographer', 'Photographer and videographer', 150, 'photo_video',
      ['How many photographers per function?', 'When will edited photos and the film be delivered?', 'Who owns the raw footage?'],
      ['Coverage hours', 'Delivery timeline', 'Editing style']),
    T('makeup_mehendi', 'Makeup and mehendi artists', 90, 'attire_beauty',
      ['Do you offer a trial?', 'How many guests can the mehendi team cover per hour?', 'Do you travel to the venue?'],
      ['Trial cost', 'Products used', 'Team size']),
    T('officiant', 'Priest or officiant', 60, 'ceremony',
      ['Which rituals will you perform and how long do they take?', 'What items should the family arrange?', 'Is travel included in the fee?'],
      ['Ritual tradition', 'Duration', 'Language of the ceremony']),
    T('music', 'Music, DJ or band', 90, 'entertainment',
      ['Do you bring your own sound system?', 'Can you play requests and handle the sangeet choreography tracks?', 'What are the overtime charges?'],
      ['Hours included', 'Equipment', 'Overtime rate']),
    T('invitations_print', 'Invitations and printing', 75, 'invitations',
      ['What is the minimum order and lead time?', 'Do you also design digital invites?', 'Can we proof before the final print?'],
      ['Price per card', 'Turnaround', 'Digital option']),
    T('transport', 'Guest transport', 45, 'transport_stay',
      ['How many vehicles and seats are available on the dates?', 'Are driver allowances and fuel included?', 'Is there a backup vehicle?'],
      ['Vehicle condition', 'All-inclusive price', 'Backup plan']),
  ],
  birthday: [
    T('venue', 'Venue', 30, 'venue',
      ['Is the date free, including decoration time?', 'Is there a minimum spend?', 'Are outside cakes and decor allowed?'],
      ['Capacity', 'Minimum spend', 'Child safety']),
    T('caterer', 'Caterer or restaurant', 21, 'catering',
      ['What is the per-head price for your menu?', 'Can you offer a kids menu?', 'How do you label allergens?'],
      ['Per-head price', 'Menu choice', 'Allergen handling']),
    T('cake_baker', 'Cake baker', 10, 'cake',
      ['What size do we need for your guest count?', 'Can you make it eggless or allergen-free?', 'Is delivery included?'],
      ['Price per kg', 'Design options', 'Delivery']),
    T('decorator', 'Decorator', 14, 'decor',
      ['What does your package include at this budget?', 'Can you work to our theme?', 'How long is setup?'],
      ['Theme fit', 'Inclusions', 'Setup time']),
    T('entertainer', 'Entertainer or activity host', 21, 'entertainment',
      ['What age group is the show designed for?', 'How long is the act?', 'What space and power do you need?'],
      ['Age fit', 'Duration', 'Reviews from past events']),
    T('photographer', 'Photographer', 21, 'photo_video',
      ['How many hours of coverage?', 'How many edited photos and by when?', 'Do you do candid shots?'],
      ['Hours', 'Delivery time', 'Style']),
    T('return_gifts', 'Return gifts', 10, 'gifts_favors',
      ['What is the minimum order?', 'Can gifts be personalised?', 'When can you deliver?'],
      ['Price per gift', 'Usefulness', 'Delivery date']),
  ],
  community: [
    T('venue', 'Ground or hall', 60, 'venue',
      ['Is the space available for setup the day before?', 'What permissions does the owner need from us?', 'Is power and water available?'],
      ['Capacity', 'Facilities', 'Access for crowds']),
    T('permits', 'Permits and permissions', 45, 'permits_safety',
      ['Which local permissions are needed (police, municipal, fire, sound)?', 'How long does approval take?', 'What documents are required?'],
      ['Processing time', 'Fees', 'Conditions attached']),
    T('sound_light', 'Sound, stage and lights', 30, 'sound_light',
      ['Is a generator backup included?', 'Do you operate within the permitted sound limits?', 'Is a technician present throughout?'],
      ['Equipment list', 'Backup power', 'Technician hours']),
    T('tent_pandal', 'Tent, pandal or seating', 30, 'decor',
      ['Is the structure rain-proof?', 'How many seats and how much shade?', 'Is fire safety equipment included?'],
      ['Safety', 'Seating count', 'Weather protection']),
    T('caterer', 'Food stalls or caterer', 30, 'catering',
      ['Can you serve the expected crowd at peak time?', 'Do you hold a food safety licence?', 'How is waste handled?'],
      ['Serving speed', 'Hygiene', 'Price per serving']),
    T('security_firstaid', 'Security and first aid', 21, 'permits_safety',
      ['How many volunteers or guards per 100 people?', 'Is a first-aid post and ambulance contact included?', 'How do you handle crowd entry and exit?'],
      ['Staffing ratio', 'Medical cover', 'Experience with crowds']),
    T('sanitation', 'Sanitation and waste', 21, 'logistics_volunteers',
      ['How many toilets and bins for the crowd size?', 'How often are they cleaned?', 'Is segregation and disposal included?'],
      ['Units per 100 people', 'Cleaning frequency', 'Disposal plan']),
    T('publicity_print', 'Publicity and printing', 21, 'publicity',
      ['What is the turnaround for banners and posters?', 'Can you design social media posts as well?', 'Are proofs included?'],
      ['Turnaround', 'Price', 'Design support']),
  ],
};

export function vendorTemplatesFor(eventType: EventType): VendorTemplate[] {
  return VENDOR_CATALOG[eventType];
}
