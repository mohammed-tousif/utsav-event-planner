import { MAX_BUDGET, MAX_GUESTS } from '../constants';
import { formatMoney } from '../money';
import type { EventInput } from '../schemas';

/**
 * Deterministic reading of exact numbers in a change request, such as
 * "reduce the budget by 20%" or "increase the guest count from 50 to 80".
 * These values are computed in code and take precedence over the model's
 * arithmetic. Requests about a single category ("cut the decor budget by
 * 20%") are left to the AI.
 */

type IntentInput = Pick<EventInput, 'totalBudget' | 'guestCount' | 'currency'>;

export interface ParsedIntent {
  totalBudget?: number;
  guestCount?: number;
  notes: string[];
}

interface Reading {
  value: number;
  note: string;
}

const CATEGORY_WORDS =
  /\b(venue|hall|food|catering|caterer|menu|decor|decoration|decorations|flowers|photo|photos|photography|video|music|dj|band|entertainment|outfit|outfits|attire|makeup|mehendi|invite|invites|invitations|cake|gifts?|favou?rs|transport|stay|sound|lights?|permits?|security|publicity|printing|volunteers?)\b/i;

const UNIT_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  cr: 10_000_000,
};

const PERCENT_CHANGE =
  /\b(reduce|cut|lower|decrease|trim|slash|drop|increase|raise|boost|grow)\b(.{0,40}?)\bbudget\b.{0,25}?\bby\s*(\d{1,2}(?:\.\d+)?)\s*(?:%|percent)/;
const ABSOLUTE_BUDGET =
  /\b(?:total |overall |the |our |my )?budget\b(.{0,20}?)\b(?:to|of|at)\s*(?:₹|rs\.?|inr|\$|usd|€|£)?\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|k|thousand|crores?|cr)?\b/;
const GUEST_WORD = /\b(guests?|people|attendees|headcount|persons|pax|invitees)\b/;

export function parseAmount(raw: string, unit?: string): number | undefined {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * (unit ? (UNIT_MULTIPLIER[unit.toLowerCase()] ?? 1) : 1));
}

function percentBudget(text: string, input: IntentInput): Reading | undefined {
  const match = PERCENT_CHANGE.exec(text);
  if (!match || CATEGORY_WORDS.test(match[2] ?? '')) return undefined;
  const up = /increase|raise|boost|grow/.test(match[1] ?? '');
  const percent = Number(match[3]);
  const factor = up ? 1 + percent / 100 : 1 - percent / 100;
  if (percent <= 0 || factor <= 0) return undefined;
  const value = Math.round(input.totalBudget * factor);
  const from = formatMoney(input.totalBudget, input.currency);
  const to = formatMoney(value, input.currency);
  return { value, note: `Total budget ${up ? 'raised' : 'reduced'} by exactly ${percent}%: ${from} → ${to}.` };
}

function absoluteBudget(text: string, input: IntentInput): Reading | undefined {
  const match = ABSOLUTE_BUDGET.exec(text);
  if (!match) return undefined;
  const before = text.slice(Math.max(0, match.index - 25), match.index);
  if (CATEGORY_WORDS.test(`${before} ${match[1] ?? ''}`)) return undefined;
  const value = parseAmount(match[2] ?? '', match[3]);
  if (!value || value > MAX_BUDGET) return undefined;
  return { value, note: `Total budget set to ${formatMoney(value, input.currency)}.` };
}

/** Each pattern turns a phrasing into a new guest count, or nothing. */
const GUEST_PATTERNS: { pattern: RegExp; read: (m: RegExpExecArray, current: number) => number }[] = [
  { pattern: /\b(?:guests?|guest count|headcount|people|attendees)\b.{0,25}?\bto\s+(\d{1,4})\b/, read: (m) => Number(m[1]) },
  { pattern: /\b(?:add|invite|another|plus)\s+(\d{1,4})\s+(?:more\s+)?(?:guests?|people)\b/, read: (m, n) => n + Number(m[1]) },
  {
    pattern: /\b(?:remove|drop|cut|minus)\s+(\d{1,4})\s+(?:guests?|people)\b|\b(\d{1,4})\s+(?:fewer|less)\s+(?:guests?|people)\b/,
    read: (m, n) => n - Number(m[1] ?? m[2]),
  },
  { pattern: /\b(?:for|make it|now|with|only|expect(?:ing)?)\s+(\d{1,4})\s+(?:guests?|people|attendees)\b/, read: (m) => Number(m[1]) },
];

function isValidGuestCount(value: number, current: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_GUESTS && value !== current;
}

function guestCount(text: string, current: number): Reading | undefined {
  if (!GUEST_WORD.test(text)) return undefined;
  // "from 50 to 80" also tells us what the user thinks the current count is.
  const fromTo = /\bfrom\s+(\d{1,4})\s*(?:guests?|people)?\s+to\s+(\d{1,4})\b/.exec(text);
  if (fromTo) {
    const value = Number(fromTo[2]);
    if (!isValidGuestCount(value, current)) return undefined;
    const stated = Number(fromTo[1]);
    const note =
      stated === current
        ? `Guest count changed from ${current} to ${value}.`
        : `Your plan had ${current} guests, not ${stated}; it now uses ${value}.`;
    return { value, note };
  }
  for (const { pattern, read } of GUEST_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = read(match, current);
    return isValidGuestCount(value, current) ? { value, note: `Guest count changed from ${current} to ${value}.` } : undefined;
  }
  return undefined;
}

export function parseIntent(request: string, input: IntentInput): ParsedIntent {
  const text = request.toLowerCase().replace(/\s+/g, ' ');
  const budget = percentBudget(text, input) ?? absoluteBudget(text, input);
  const guests = guestCount(text, input.guestCount);
  return {
    ...(budget && { totalBudget: budget.value }),
    ...(guests && { guestCount: guests.value }),
    notes: [budget?.note, guests?.note].filter((note): note is string => Boolean(note)),
  };
}
