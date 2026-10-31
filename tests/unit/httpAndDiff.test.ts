import { describe, expect, it } from 'vitest';
import { describeDiff, tabForDiff } from '../../src/client/components/plan/describe';
import { AiError } from '../../src/server/ai/types';
import { HttpError, toHttpError } from '../../src/server/http/errors';
import { BudgetInfeasibleError } from '../../src/shared/budget';
import { diffPlans, RevisionError } from '../../src/shared/revision';
import { DateRangeError } from '../../src/shared/timeline';
import { makePlan } from '../fixtures';

describe('toHttpError', () => {
  it.each([
    [new DateRangeError('past'), 400, 'invalid_date'],
    [new BudgetInfeasibleError('too much'), 422, 'budget_infeasible'],
    [new RevisionError('no_change', 'same'), 422, 'no_change'],
    [new RevisionError('infeasible', 'locks'), 422, 'budget_infeasible'],
    [new RevisionError('invalid_change', 'bad date'), 400, 'invalid_date'],
    [new AiError('rate_limited', 'busy', 60), 429, 'ai_rate_limited'],
    [new AiError('timeout', 'slow'), 504, 'ai_timeout'],
  ])('maps %o to HTTP %i', (error, status, code) => {
    const http = toHttpError(error) as HttpError;
    expect(http).toBeInstanceOf(HttpError);
    expect({ status: http.status, code: http.code, message: http.message }).toEqual({ status, code, message: error.message });
  });

  it('keeps the retry hint from the AI provider', () => {
    expect((toHttpError(new AiError('rate_limited', 'busy', 60)) as HttpError).retryAfterSeconds).toBe(60);
  });

  it('leaves unknown errors for the generic handler', () => {
    const error = new Error('surprise');
    expect(toHttpError(error)).toBe(error);
  });
});

describe('describing a change', () => {
  const plan = makePlan();

  it('summarises totals, guests and moved categories', () => {
    const after = { ...plan, input: { ...plan.input, guestCount: 300 }, budget: { ...plan.budget, total: 1_200_000 } };
    after.budget.lines = plan.budget.lines.map((l, i) => (i === 0 ? { ...l, amount: l.amount - 1000 } : l));
    const diff = diffPlans(plan, after, []);
    expect(describeDiff(diff, plan)).toBe('Total ₹15,00,000 to ₹12,00,000. Guests 250 to 300. 1 budget category changed.');
    expect(tabForDiff(diff)).toBe('budget');
  });

  it('opens the rewritten section when only a section changed', () => {
    const diff = diffPlans(plan, plan, ['vendors']);
    expect(describeDiff(diff, plan)).toBe('Rewrote vendors.');
    expect(tabForDiff(diff)).toBe('vendors');
    expect(tabForDiff(diffPlans(plan, plan, ['schedule']))).toBe('timeline');
    expect(describeDiff(diffPlans(plan, plan, []), plan)).toBe('Updated.');
  });
});
