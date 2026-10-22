import type { Currency } from './constants';

const LOCALE: Record<Currency, string> = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'en-IE',
  GBP: 'en-GB',
  AED: 'en-AE',
  SGD: 'en-SG',
};

const formatters = new Map<Currency, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: Currency): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE[currency], {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    formatters.set(currency, formatter);
  }
  return formatter.format(Math.round(amount));
}

/** Signed money, e.g. "+₹12,000" or "−₹8,500". */
export function formatMoneyDelta(delta: number, currency: Currency): string {
  if (delta === 0) return formatMoney(0, currency);
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${formatMoney(Math.abs(delta), currency)}`;
}

/**
 * The unit allocations are rounded to, so the plan shows tidy numbers.
 * Smaller budgets use finer steps to keep the rounding error negligible.
 */
export function roundingStep(currency: Currency, total: number): number {
  if (currency === 'INR') {
    if (total >= 200_000) return 500;
    if (total >= 20_000) return 100;
    if (total >= 2_000) return 10;
    return 1;
  }
  if (total >= 20_000) return 10;
  if (total >= 1_000) return 5;
  return 1;
}
