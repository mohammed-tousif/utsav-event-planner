import { ApiError } from '@google/genai';
import { AiError } from './types';

/** Keeps provider error text short and free of anything that looks like a key. */
export function redact(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/key=[^&\s]+/gi, 'key=[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function isTimeout(error: unknown): error is Error {
  return (
    error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /timed? ?out|aborted/i.test(error.message))
  );
}

function isKeyProblem(error: ApiError): boolean {
  return (error.status === 400 && /api[ _-]?key/i.test(error.message)) || error.status === 401 || error.status === 403;
}

/** Maps an HTTP error from the Gemini API to a user-facing error with log-only diagnostics. */
function fromApiError(error: ApiError): AiError {
  const diagnostics = { status: error.status, reason: redact(error.message) };
  if (error.status === 429) {
    return new AiError('rate_limited', 'The AI is busy or the free quota is used up. Wait a minute and try again.', 60, diagnostics);
  }
  if (isKeyProblem(error)) return new AiError('not_configured', 'The AI key on the server is not valid.', undefined, diagnostics);
  if (error.status === 404) return new AiError('unavailable', 'The configured AI model is not available.', undefined, diagnostics);
  if (error.status >= 500)
    return new AiError('unavailable', 'The AI service is having problems. Try again shortly.', undefined, diagnostics);
  // Any other 4xx means the request itself was rejected, so another request style may work.
  return new AiError('invalid_output', 'The AI could not process this request.', undefined, { ...diagnostics, badRequest: true });
}

/** Turns anything thrown during a Gemini call into an AiError users can act on. */
export function toAiError(error: unknown, signal: AbortSignal | undefined): AiError {
  if (error instanceof AiError) return error;
  if (signal?.aborted) return new AiError('timeout', 'The request was cancelled.');
  if (isTimeout(error)) return new AiError('timeout', 'The AI took too long to answer. Try again.', undefined, { reason: error.name });
  if (error instanceof ApiError) return fromApiError(error);
  const reason = error instanceof Error ? redact(`${error.name}: ${error.message}`) : 'unknown error';
  return new AiError('unavailable', 'Could not reach the AI service.', undefined, { reason });
}

/** Errors after which the next fallback model is worth trying. */
export function canFallBack(error: AiError, signal: AbortSignal | undefined): boolean {
  return ['rate_limited', 'unavailable', 'invalid_output', 'timeout'].includes(error.kind) && !signal?.aborted;
}
