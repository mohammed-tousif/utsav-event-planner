import type { ApiErrorBody, ApiErrorCode, GenerateResponse, ReviseResponse, StatusResponse } from '../../shared/api';
import { todayISO } from '../../shared/dates';
import type { EventInput, Plan } from '../../shared/schemas';

export class ClientApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | 'network' | 'aborted' | 'client_timeout',
    message: string,
    public readonly fields: Record<string, string> = {},
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }

  /** Worth offering "Try again": the request itself was fine. */
  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

const CLIENT_TIMEOUT_MS = 150_000;

const RETRYABLE: readonly string[] = [
  'network',
  'client_timeout',
  'ai_timeout',
  'ai_unavailable',
  'ai_invalid_output',
  'ai_rate_limited',
  'rate_limited',
  'internal',
];

/** Why a fetch failed before any response arrived. */
function fetchFailure(error: unknown, userSignal: AbortSignal | undefined, timeout: AbortSignal): ClientApiError {
  if (userSignal?.aborted) return new ClientApiError('aborted', 'Cancelled.');
  if (timeout.aborted) return new ClientApiError('client_timeout', 'The planner took too long to answer. Try again.');
  if (error instanceof DOMException && error.name === 'AbortError') return new ClientApiError('aborted', 'Cancelled.');
  return new ClientApiError('network', 'Could not reach Utsav. Check your connection and try again.');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ClientApiError('internal', `The server sent an unreadable reply (HTTP ${response.status}).`);
  }
}

function responseFailure(body: unknown, status: number): ClientApiError {
  const error = (body as Partial<ApiErrorBody>).error;
  return new ClientApiError(
    error?.code ?? 'internal',
    error?.message ?? `Request failed (HTTP ${status}).`,
    error?.fields,
    error?.retryAfterSeconds,
  );
}

async function request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    throw fetchFailure(error, init.signal, timeout);
  }
  const body = await readJson(response);
  if (!response.ok) throw responseFailure(body, response.status);
  return body as T;
}

export const clientToday = (): string => todayISO();

export function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  return request<StatusResponse>('/api/status', { signal });
}

export function generatePlan(input: EventInput, signal?: AbortSignal): Promise<GenerateResponse> {
  return request<GenerateResponse>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ input, clientToday: clientToday() }),
    signal,
  });
}

export function revisePlan(plan: Plan, change: string, signal?: AbortSignal): Promise<ReviseResponse> {
  return request<ReviseResponse>('/api/plans/revise', {
    method: 'POST',
    // The previous AI exchange is only for display, so it is not sent back.
    body: JSON.stringify({ plan: { ...plan, meta: { ...plan.meta, exchange: undefined } }, request: change, clientToday: clientToday() }),
    signal,
  });
}
