import { BudgetInfeasibleError } from '../budget';
import { DateRangeError } from '../timeline';

export type RevisionErrorCode = 'no_change' | 'infeasible' | 'invalid_change';

/** A requested change that cannot be applied, with a message users can act on. */
export class RevisionError extends Error {
  constructor(
    public readonly code: RevisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RevisionError';
  }
}

/** Runs a budget calculation, turning an impossible budget into a RevisionError. */
export function withBudget<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof BudgetInfeasibleError) throw new RevisionError('infeasible', error.message);
    throw error;
  }
}

/** Runs a date calculation, turning an out-of-range date into a RevisionError. */
export function withDate<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof DateRangeError) throw new RevisionError('invalid_change', error.message);
    throw error;
  }
}
