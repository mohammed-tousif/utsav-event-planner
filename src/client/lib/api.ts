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

  get retryable(): boolean {
    return ['network', 'client_timeout', 'ai_timeout', 'ai_unavailable', 'ai_invalid_output', 'ai_rate_limited', 'rate_limited', 'internal'].includes(this.code);
  }
}

const CLIENT_TIMEOUT_MS = 150_000;

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
    if (init.signal?.aborted) throw new ClientApiError('aborted', 'Cancelled.');
    if (timeout.aborted) throw new ClientApiError('client_timeout', 'The planner took too long to answer. Try again.');
    if (error instanceof DOMException && error.name === 'AbortError') throw new ClientApiError('aborted', 'Cancelled.');
    throw new ClientApiError('network', 'Could not reach Utsav. Check your connection and try again.');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ClientApiError('internal', `The server sent an unreadable reply (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error = (body as Partial<ApiErrorBody>).error;
    throw new ClientApiError(
      error?.code ?? 'internal',
      error?.message ?? `Request failed (HTTP ${response.status}).`,
      error?.fields,
      error?.retryAfterSeconds,
    );
  }
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
    body: JSON.stringify({ plan, request: change, clientToday: clientToday() }),
    signal,
  });
}
