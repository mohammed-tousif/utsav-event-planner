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
    /** Diagnostics for server logs only (HTTP status and a redacted reason). Never sent to users. */
    public readonly diagnostics?: { status?: number; reason?: string; badRequest?: boolean },
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiResult<T> {
  data: T;
  /** Which model actually produced the answer (after any fallback). */
  model: string;
  /** The prompt that was sent and the model's raw reply, shown to the user for transparency. */
  exchange: { prompt: string; reply: string };
}

export interface AiProvider {
  readonly name: 'gemini' | 'sample';
  readonly model: string;
  readonly configured: boolean;
  generatePlan(input: EventInput, today: string, signal?: AbortSignal): Promise<AiResult<AiPlanDraft>>;
  revisePlan(plan: Plan, request: string, today: string, signal?: AbortSignal): Promise<AiResult<AiRevision>>;
}
