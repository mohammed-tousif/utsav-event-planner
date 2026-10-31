import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody, ApiErrorCode } from '../../shared/api';
import { BudgetInfeasibleError } from '../../shared/budget';
import { RevisionError } from '../../shared/revision';
import { DateRangeError } from '../../shared/timeline';
import { AiError, type AiErrorKind } from '../ai/types';
import type { Logger } from '../logger';

/** An error with an HTTP status and a message that is safe to show users. */
export class HttpError extends Error {
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    extra: { fields?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.fields = extra.fields;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

const AI_ERROR_STATUS: Record<AiErrorKind, [number, ApiErrorCode]> = {
  not_configured: [503, 'ai_not_configured'],
  rate_limited: [429, 'ai_rate_limited'],
  timeout: [504, 'ai_timeout'],
  invalid_output: [502, 'ai_invalid_output'],
  blocked: [422, 'ai_blocked'],
  unavailable: [503, 'ai_unavailable'],
};

const REVISION_ERROR_STATUS: Record<RevisionError['code'], [number, ApiErrorCode]> = {
  no_change: [422, 'no_change'],
  infeasible: [422, 'budget_infeasible'],
  invalid_change: [400, 'invalid_date'],
};

/** Maps planning and AI errors to HTTP errors; anything else is returned unchanged. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof DateRangeError) return new HttpError(400, 'invalid_date', error.message, { fields: { eventDate: error.message } });
  if (error instanceof BudgetInfeasibleError) return new HttpError(422, 'budget_infeasible', error.message);
  if (error instanceof RevisionError) {
    const [status, code] = REVISION_ERROR_STATUS[error.code];
    return new HttpError(status, code, error.message);
  }
  if (error instanceof AiError) {
    const [status, code] = AI_ERROR_STATUS[error.kind];
    return new HttpError(status, code, error.message, { retryAfterSeconds: error.retryAfterSeconds });
  }
  return error;
}

function hasProperty(error: unknown, key: 'type' | 'status', value: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && key in (error as object) && (error as Record<string, unknown>)[key] === value;
}

/** Errors raised by Express itself (body parser, static files) mapped to API errors. */
function fromFrameworkError(error: unknown): HttpError | undefined {
  if (hasProperty(error, 'type', 'entity.too.large')) return new HttpError(413, 'payload_too_large', 'That request is too large.');
  if (hasProperty(error, 'type', 'entity.parse.failed')) return new HttpError(400, 'invalid_input', 'The request was not valid JSON.');
  if (hasProperty(error, 'status', 404)) return new HttpError(404, 'not_found', 'Not found.');
  return undefined;
}

function errorBody(http: HttpError): ApiErrorBody {
  return {
    error: {
      code: http.code,
      message: http.message,
      ...(http.fields ? { fields: http.fields } : {}),
      ...(http.retryAfterSeconds ? { retryAfterSeconds: http.retryAfterSeconds } : {}),
    },
  };
}

/** Final Express error handler: logs operational details only and returns a safe JSON error. */
export function errorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    let http = error instanceof HttpError ? error : fromFrameworkError(error);
    if (!http) {
      http = new HttpError(500, 'internal', 'Something went wrong on our side. Try again.');
      logger.log('error', 'unhandled_error', { route: req.path, name: error instanceof Error ? error.name : 'unknown' });
    }
    if (http.status !== 404) {
      logger.log(http.status >= 500 ? 'error' : 'warn', 'request_failed', { route: req.path, status: http.status, code: http.code });
    }
    if (http.retryAfterSeconds) res.setHeader('Retry-After', String(http.retryAfterSeconds));
    res.status(http.status).json(errorBody(http));
  };
}
