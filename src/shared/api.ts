import type { Plan, PlanDiff } from './schemas';

export type ApiErrorCode =
  | 'invalid_input'
  | 'invalid_date'
  | 'budget_infeasible'
  | 'no_change'
  | 'ai_not_configured'
  | 'ai_rate_limited'
  | 'ai_timeout'
  | 'ai_invalid_output'
  | 'ai_blocked'
  | 'ai_unavailable'
  | 'rate_limited'
  | 'payload_too_large'
  | 'not_found'
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
    retryAfterSeconds?: number;
  };
}

export interface StatusResponse {
  ok: true;
  ai: {
    provider: 'gemini' | 'sample';
    model: string;
    configured: boolean;
    sampleData: boolean;
  };
  version: string;
}

export interface GenerateResponse {
  plan: Plan;
  cached: boolean;
}

export interface ReviseResponse {
  plan: Plan;
  diff: PlanDiff;
}
