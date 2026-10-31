import type { Response } from 'express';
import type { z } from 'zod';
import { daysBetween, todayISO } from '../../shared/dates';
import { HttpError } from './errors';

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.filter((p) => p !== 'input').join('.') || 'request';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Validates a request body, turning zod issues into per-field messages. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'invalid_input', 'Some details need fixing before we can plan.', { fields: fieldErrors(result.error) });
  }
  return result.data;
}

/**
 * The browser sends its local date so plans use the user's calendar. It must
 * be within a day of the server's UTC date, which covers every time zone.
 */
export function resolveToday(clientToday: string, now: Date): string {
  const serverToday = todayISO('UTC', now);
  if (Math.abs(daysBetween(serverToday, clientToday)) > 1) {
    throw new HttpError(400, 'invalid_input', 'Your device date looks wrong. Check the date and time settings.', {
      fields: { clientToday: 'Device date is more than a day away from the current date.' },
    });
  }
  return clientToday;
}

/** An AbortSignal that fires when the client goes away before the response is sent, so AI calls stop early. */
export function abortOnClose(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}
