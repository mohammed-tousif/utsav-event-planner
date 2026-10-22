import { CATEGORY_KEYS, TASK_AREAS, TASK_PRIORITIES } from '../../shared/constants';
import { VENDOR_KEYS } from '../../shared/vendorCatalog';

/**
 * Repairs small, predictable deviations in model JSON before strict zod
 * validation: numbers sent as strings, 12-hour times, unknown enum values,
 * missing optional lists. Anything that cannot be repaired is dropped or left
 * for validation to reject. This matters most in compatibility mode, where the
 * API does not enforce the schema.
 */

type Json = Record<string, unknown>;

const NUMERIC = new Set(['factor', 'offsetDays', 'durationMin', 'estimatedCost', 'contingencyPct', 'totalBudget', 'guestCount']);
const BOOLEAN = new Set(['regenerateTasks', 'regenerateSchedule', 'regenerateVendors', 'regenerateIdeas']);
const STRING_LISTS = new Set(['tradeoffs', 'assumptions', 'changeSummary', 'questions', 'compareOn', 'redFlags']);

const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const inSet = (values: readonly string[]) => (value: unknown): value is string => typeof value === 'string' && values.includes(value);
const isCategory = inSet(CATEGORY_KEYS);
const isVendor = inSet(VENDOR_KEYS);

function toNumber(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,%₹$\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function toBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** "7:00", "7 pm", "07:30 PM", "19:00:00" → "HH:MM"; undefined if unreadable. */
export function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(value);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeScalars(node: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (NUMERIC.has(key)) out[key] = toNumber(value);
    else if (BOOLEAN.has(key)) out[key] = toBoolean(value);
    else if (STRING_LISTS.has(key)) out[key] = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
    else out[key] = value;
  }
  return out;
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject).map(normalizeScalars) : [];
}

export function normalizeModelJson(raw: unknown): unknown {
  if (!isObject(raw)) return raw;
  const node = normalizeScalars(raw);

  if ('adjustments' in node) node.adjustments = list(node.adjustments).filter((a) => isCategory(a.category));
  if ('tasks' in node) {
    node.tasks = list(node.tasks).map((t) => ({
      notes: '',
      ...t,
      area: inSet(TASK_AREAS)(t.area) ? t.area : 'other',
      priority: inSet(TASK_PRIORITIES)(t.priority) ? t.priority : 'medium',
    }));
  }
  if ('schedule' in node) {
    node.schedule = list(node.schedule)
      .map((s) => ({ notes: '', segment: 'Event day', ...s, time: normalizeTime(s.time) }))
      .filter((s) => s.time !== undefined);
  }
  if ('vendors' in node) {
    node.vendors = list(node.vendors)
      .filter((v) => isVendor(v.category))
      .map((v) => ({ why: '', ...v, questions: v.questions ?? [], compareOn: v.compareOn ?? [], redFlags: v.redFlags ?? [] }));
  }
  if ('ideas' in node) {
    node.ideas = list(node.ideas).map((i) => ({
      whyItFits: '',
      description: '',
      ...i,
      budgetCategory: isCategory(i.budgetCategory) ? i.budgetCategory : 'decor',
      effort: inSet(['low', 'medium', 'high'])(i.effort) ? i.effort : 'medium',
    }));
  }
  for (const key of ['lockCategories', 'unlockCategories']) {
    if (key in node) node[key] = Array.isArray(node[key]) ? (node[key] as unknown[]).filter(isCategory) : [];
  }
  return node;
}
