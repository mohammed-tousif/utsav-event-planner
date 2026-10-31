import { daysBetween } from '../../shared/dates';

const longDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDateYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const asUTC = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** e.g. "Sun, 14 February 2027". */
export const formatLongDate = (iso: string): string => longDate.format(asUTC(iso));
/** e.g. "6 Nov" or "6 Nov 2026". */
export const formatShortDate = (iso: string, withYear = false): string => (withYear ? shortDateYear : shortDate).format(asUTC(iso));

/** How far away a date is, in words ("Tomorrow", "In about 4 months"). */
export function daysToGoLabel(eventDate: string, today: string): string {
  const days = daysBetween(today, eventDate);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 60) return `In ${days} days`;
  const months = Math.round(days / 30.4);
  return `In about ${months} months`;
}

/** A task deadline in words, with an urgency tone for styling. */
export function dueLabel(dueDate: string, today: string): { text: string; tone: 'overdue' | 'soon' | 'later' } {
  const days = daysBetween(today, dueDate);
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? '' : 's'}`, tone: 'overdue' };
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days <= 7) return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon' };
  return { text: `Due ${formatShortDate(dueDate, true)}`, tone: 'later' };
}

/** A share as a percentage with one decimal place. */
export const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '0%');

/** A 24-hour "HH:MM" time as "7:30 pm". */
export const formatTime = (time: string): string => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** A vendor booking deadline in words, with an urgency tone for styling. */
export function bookByLabel(bookBy: string, today: string): { text: string; tone: 'overdue' | 'soon' | 'later' } {
  const days = daysBetween(today, bookBy);
  if (days < 0) return { text: `Booking deadline passed ${-days} day${days === -1 ? '' : 's'} ago`, tone: 'overdue' };
  if (days === 0) return { text: 'Book today', tone: 'soon' };
  if (days <= 7) return { text: `Book within ${days} day${days === 1 ? '' : 's'}`, tone: 'soon' };
  return { text: `Book by ${formatShortDate(bookBy, true)}`, tone: 'later' };
}
