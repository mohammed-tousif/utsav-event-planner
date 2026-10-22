import {
  CATEGORY_META,
  EVENT_CONFIG,
  categoriesFor,
  type CategoryKey,
  type Currency,
  type EventType,
  type PriorityKey,
} from './constants';
import { formatMoney, roundingStep } from './money';
import type { Budget, BudgetLine, BudgetWarning } from './schemas';

export const AI_FACTOR_MIN = 0.5;
export const AI_FACTOR_MAX = 1.6;
export const PRIORITY_BOOST = 1.3;
export const CONTINGENCY_MIN = 0;
export const CONTINGENCY_MAX = 30;

export interface BudgetParams {
  eventType: EventType;
  currency: Currency;
  total: number;
  guestCount: number;
  priorities: readonly PriorityKey[];
  contingencyPct: number;
  /** AI-suggested multipliers per category; clamped before use. */
  aiFactors?: Partial<Record<CategoryKey, number>>;
  /** Categories the user locked: amounts kept and shown as locked. */
  locked?: Partial<Record<CategoryKey, number>>;
  /**
   * Amounts to keep for this calculation only (not shown as locked). Used
   * for targeted edits such as "reduce decoration costs", where the other
   * lines stay as they were and contingency absorbs the difference.
   */
  fixed?: Partial<Record<CategoryKey, number>>;
  /** Short AI explanations to carry onto each line. */
  rationales?: Partial<Record<CategoryKey, string>>;
  tradeoffs?: string[];
}

export class BudgetInfeasibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetInfeasibleError';
  }
}

export function clampFactor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(AI_FACTOR_MAX, Math.max(AI_FACTOR_MIN, value));
}

export function clampContingency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(CONTINGENCY_MAX, Math.max(CONTINGENCY_MIN, Math.round(value * 10) / 10));
}

/**
 * The relative weight of each category before money is assigned:
 * base weight × guest scaling × priority boost × AI factor.
 */
export function categoryWeights(params: BudgetParams): Record<CategoryKey, number> {
  const config = EVENT_CONFIG[params.eventType];
  const guestRatio = Math.max(params.guestCount, 1) / config.referenceGuests;
  const weights = {} as Record<CategoryKey, number>;
  for (const key of categoriesFor(params.eventType)) {
    const meta = CATEGORY_META[key];
    const base = config.baseWeights[key] ?? 0;
    const scaled = base * guestRatio ** meta.guestExponent;
    const boosted = meta.boostedBy.some((p) => params.priorities.includes(p)) ? scaled * PRIORITY_BOOST : scaled;
    weights[key] = boosted * clampFactor(params.aiFactors?.[key]);
  }
  return weights;
}

/**
 * Splits the total budget across categories.
 *
 * Guarantees (covered by unit tests):
 * - every amount is a non-negative multiple of the rounding step, except
 *   contingency, which absorbs the rounding remainder;
 * - lines + contingency add up to the total exactly;
 * - locked categories keep their amount; if they cannot fit, the function
 *   throws instead of overspending.
 */
export function computeBudget(params: BudgetParams): Budget {
  const { total, currency, guestCount } = params;
  if (!Number.isFinite(total) || total <= 0) throw new BudgetInfeasibleError('The total budget must be more than zero.');
  if (!Number.isInteger(guestCount) || guestCount < 1) throw new BudgetInfeasibleError('Guest count must be at least one.');

  const keys = categoriesFor(params.eventType);
  const warnings: BudgetWarning[] = [];
  const totalUnits = Math.round(total);
  const step = roundingStep(currency, totalUnits);

  // Locked and fixed categories first.
  const pinned = (key: CategoryKey) => params.locked?.[key] ?? params.fixed?.[key];
  const lockedEntries = keys
    .filter((key) => pinned(key) !== undefined)
    .map((key) => [key, Math.max(0, Math.round(pinned(key) ?? 0))] as const);
  const lockedSum = lockedEntries.reduce((sum, [, amount]) => sum + amount, 0);
  if (lockedSum > totalUnits) {
    const names = lockedEntries
      .filter(([key]) => params.locked?.[key] !== undefined)
      .map(([key]) => CATEGORY_META[key].label)
      .join(', ');
    throw new BudgetInfeasibleError(
      `Kept-unchanged categories (${names || 'all'}) need ${formatMoney(lockedSum, currency)}, more than the total of ${formatMoney(totalUnits, currency)}. Unlock a category or raise the budget.`,
    );
  }

  // Contingency is reduced (never negative) if locks leave too little room.
  const contingencyPct = clampContingency(params.contingencyPct);
  let contingency = Math.floor((totalUnits * contingencyPct) / 100);
  if (lockedSum + contingency > totalUnits) {
    contingency = totalUnits - lockedSum;
    warnings.push({
      code: 'contingency_reduced',
      level: 'warn',
      message: 'Kept-unchanged categories leave less room for contingency than you asked for.',
    });
  }

  const distributable = totalUnits - lockedSum - contingency;
  const weights = categoryWeights(params);
  const unlockedKeys = keys.filter((key) => pinned(key) === undefined);
  const weightSum = unlockedKeys.reduce((sum, key) => sum + weights[key], 0);

  const amounts = new Map<CategoryKey, number>(lockedEntries);
  let assigned = 0;
  for (const key of unlockedKeys) {
    const share = weightSum > 0 ? (distributable * weights[key]) / weightSum : 0;
    const rounded = Math.max(0, Math.floor(share / step) * step);
    amounts.set(key, rounded);
    assigned += rounded;
  }
  // Rounding leftovers go to contingency so the books balance exactly.
  contingency += distributable - assigned;

  const lines: BudgetLine[] = keys.map((key) => ({
    key,
    label: CATEGORY_META[key].label,
    amount: amounts.get(key) ?? 0,
    weight: Math.round(weights[key] * 1000) / 1000,
    locked: params.locked?.[key] !== undefined,
    rationale: params.rationales?.[key] ?? '',
  }));

  warnings.push(...budgetWarnings(params, lines));

  return {
    currency,
    total: totalUnits,
    contingencyPct,
    contingency,
    lines,
    perGuest: Math.round(totalUnits / guestCount),
    warnings,
    tradeoffs: params.tradeoffs ?? [],
  };
}

/** Rough INR per-guest levels below which plans get hard. Not quotes. */
const TIGHT_PER_GUEST_INR: Record<EventType, number> = { wedding: 1200, birthday: 450, community: 120 };
const TIGHT_FOOD_PER_GUEST_INR: Record<EventType, number> = { wedding: 400, birthday: 220, community: 60 };
const HIGH_PER_GUEST_INR = 500_000;

export function budgetWarnings(params: BudgetParams, lines: BudgetLine[]): BudgetWarning[] {
  const warnings: BudgetWarning[] = [];
  const perGuest = params.total / params.guestCount;
  if (params.currency === 'INR') {
    if (perGuest < TIGHT_PER_GUEST_INR[params.eventType]) {
      warnings.push({
        code: 'tight_budget',
        level: 'warn',
        message: `About ${formatMoney(perGuest, 'INR')} per guest is tight for a ${params.eventType === 'community' ? 'community event' : params.eventType}. Expect to simplify food, decor or the guest list.`,
      });
    }
    const food = lines.find((line) => line.key === 'catering');
    if (food && food.amount / params.guestCount < TIGHT_FOOD_PER_GUEST_INR[params.eventType]) {
      warnings.push({
        code: 'tight_food',
        level: 'warn',
        message: `Food works out to ${formatMoney(food.amount / params.guestCount, 'INR')} per guest, below typical catering rates. Consider a simpler menu or fewer guests.`,
      });
    }
    if (perGuest > HIGH_PER_GUEST_INR) {
      warnings.push({
        code: 'unusually_high',
        level: 'info',
        message: 'The budget per guest is unusually high. Check the total and guest count for a typo.',
      });
    }
  } else {
    warnings.push({
      code: 'no_benchmark',
      level: 'info',
      message: 'Budget checks use Indian price levels, so tight-budget warnings are only shown for INR plans.',
    });
  }
  return warnings;
}

/** Locked amounts taken from an existing budget's lines. */
export function lockedAmounts(lines: readonly BudgetLine[]): Partial<Record<CategoryKey, number>> {
  const locked: Partial<Record<CategoryKey, number>> = {};
  for (const line of lines) if (line.locked) locked[line.key] = line.amount;
  return locked;
}

export function allocatedTotal(budget: Budget): number {
  return budget.lines.reduce((sum, line) => sum + line.amount, 0) + budget.contingency;
}
