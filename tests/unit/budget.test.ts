import { describe, expect, it } from 'vitest';
import {
  AI_FACTOR_MAX,
  AI_FACTOR_MIN,
  BudgetInfeasibleError,
  allocatedTotal,
  clampContingency,
  clampFactor,
  computeBudget,
  type BudgetParams,
} from '../../src/shared/budget';
import { categoriesFor, EVENT_TYPES } from '../../src/shared/constants';

const base: BudgetParams = {
  eventType: 'wedding',
  currency: 'INR',
  total: 1_500_000,
  guestCount: 250,
  priorities: [],
  contingencyPct: 8,
};

describe('computeBudget', () => {
  it.each(EVENT_TYPES)('allocates the whole %s budget exactly, with no negative lines', (eventType) => {
    for (const total of [5_000, 99_999, 1_500_000, 37_123_457]) {
      const budget = computeBudget({ ...base, eventType, total, guestCount: 120 });
      expect(allocatedTotal(budget)).toBe(total);
      expect(budget.lines.every((l) => l.amount >= 0)).toBe(true);
      expect(budget.contingency).toBeGreaterThanOrEqual(0);
      expect(budget.lines.map((l) => l.key)).toEqual(categoriesFor(eventType));
    }
  });

  it('rounds allocations to tidy steps and puts the remainder in contingency', () => {
    const budget = computeBudget({ ...base, total: 1_234_567 });
    expect(budget.lines.every((l) => l.amount % 500 === 0)).toBe(true);
    expect(allocatedTotal(budget)).toBe(1_234_567);
  });

  it('works for very small budgets without going negative', () => {
    const budget = computeBudget({ ...base, eventType: 'birthday', total: 7, guestCount: 3 });
    expect(allocatedTotal(budget)).toBe(7);
    expect(budget.lines.every((l) => l.amount >= 0)).toBe(true);
  });

  it('gives prioritised categories a bigger share', () => {
    const plain = computeBudget(base);
    const foodFirst = computeBudget({ ...base, priorities: ['food'] });
    const share = (b: typeof plain) => b.lines.find((l) => l.key === 'catering')!.amount;
    expect(share(foodFirst)).toBeGreaterThan(share(plain));
  });

  it('scales per-guest categories with the guest count', () => {
    const small = computeBudget({ ...base, guestCount: 100 });
    const large = computeBudget({ ...base, guestCount: 600 });
    const food = (b: typeof small) => b.lines.find((l) => l.key === 'catering')!.amount;
    const attire = (b: typeof small) => b.lines.find((l) => l.key === 'attire_beauty')!.amount;
    expect(food(large)).toBeGreaterThan(food(small));
    expect(attire(large)).toBeLessThan(attire(small));
  });

  it('applies AI factors within the allowed range', () => {
    const extreme = computeBudget({ ...base, aiFactors: { decor: 50 } });
    const capped = computeBudget({ ...base, aiFactors: { decor: AI_FACTOR_MAX } });
    expect(extreme.lines.find((l) => l.key === 'decor')!.amount).toBe(capped.lines.find((l) => l.key === 'decor')!.amount);
    expect(clampFactor(-3)).toBe(AI_FACTOR_MIN);
    expect(clampFactor(Number.NaN)).toBe(1);
    expect(clampFactor(undefined)).toBe(1);
  });

  it('keeps locked categories at their exact amounts', () => {
    const budget = computeBudget({ ...base, total: 1_000_000, locked: { venue: 333_333 } });
    const venue = budget.lines.find((l) => l.key === 'venue')!;
    expect(venue.amount).toBe(333_333);
    expect(venue.locked).toBe(true);
    expect(allocatedTotal(budget)).toBe(1_000_000);
  });

  it('refuses locks that exceed the total instead of overspending', () => {
    expect(() => computeBudget({ ...base, total: 100_000, locked: { venue: 90_000, catering: 20_000 } })).toThrow(BudgetInfeasibleError);
  });

  it('reduces contingency rather than going negative when locks leave little room', () => {
    const budget = computeBudget({ ...base, total: 100_000, contingencyPct: 20, locked: { venue: 95_000 } });
    expect(budget.contingency).toBeGreaterThanOrEqual(0);
    expect(allocatedTotal(budget)).toBe(100_000);
    expect(budget.warnings.map((w) => w.code)).toContain('contingency_reduced');
  });

  it('keeps fixed amounts without marking them as locked', () => {
    const budget = computeBudget({ ...base, fixed: { decor: 10_000 } });
    const decor = budget.lines.find((l) => l.key === 'decor')!;
    expect(decor.amount).toBe(10_000);
    expect(decor.locked).toBe(false);
  });

  it('rejects zero, negative and non-finite totals and guest counts', () => {
    expect(() => computeBudget({ ...base, total: 0 })).toThrow(BudgetInfeasibleError);
    expect(() => computeBudget({ ...base, total: -5 })).toThrow(BudgetInfeasibleError);
    expect(() => computeBudget({ ...base, total: Number.POSITIVE_INFINITY })).toThrow(BudgetInfeasibleError);
    expect(() => computeBudget({ ...base, guestCount: 0 })).toThrow(BudgetInfeasibleError);
    expect(() => computeBudget({ ...base, guestCount: 2.5 })).toThrow(BudgetInfeasibleError);
  });

  it('clamps contingency to 0–30%', () => {
    expect(clampContingency(-4)).toBe(0);
    expect(clampContingency(90)).toBe(30);
    expect(clampContingency(Number.NaN)).toBe(0);
    expect(computeBudget({ ...base, contingencyPct: 99 }).contingencyPct).toBe(30);
  });

  it('warns when an INR budget is tight per guest', () => {
    const tight = computeBudget({ ...base, total: 150_000, guestCount: 300 });
    expect(tight.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['tight_budget', 'tight_food']));
    const comfortable = computeBudget(base);
    expect(comfortable.warnings.map((w) => w.code)).not.toContain('tight_budget');
  });

  it('flags implausibly high budgets and explains missing benchmarks for other currencies', () => {
    expect(computeBudget({ ...base, total: 900_000_000, guestCount: 10 }).warnings.map((w) => w.code)).toContain('unusually_high');
    expect(computeBudget({ ...base, currency: 'USD', total: 40_000 }).warnings.map((w) => w.code)).toEqual(['no_benchmark']);
  });

  it('keeps the currency on the budget', () => {
    expect(computeBudget({ ...base, currency: 'GBP', total: 20_000 }).currency).toBe('GBP');
  });
});
