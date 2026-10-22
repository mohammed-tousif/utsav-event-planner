import type { AiPlanDraft, AiRevision, EventInput, Plan } from '../../shared/schemas';

export type AiErrorKind =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_output'
  | 'blocked'
  | 'unavailable';

/** A failure talking to the AI provider, mapped to something users can act on. */
export class AiError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiResult<T> {
  data: T;
  /** Which model actually produced the answer (after any fallback). */
  model: string;
}

export interface AiProvider {
  readonly name: 'gemini' | 'sample';
  readonly model: string;
  readonly configured: boolean;
  generatePlan(input: EventInput, today: string, signal?: AbortSignal): Promise<AiResult<AiPlanDraft>>;
  revisePlan(plan: Plan, request: string, today: string, signal?: AbortSignal): Promise<AiResult<AiRevision>>;
}
