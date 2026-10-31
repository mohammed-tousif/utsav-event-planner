/** API request bodies. */
import { z } from 'zod';
import { isoDate, text } from './fields';
import { EventInputSchema } from './input';
import { PlanSchema } from './plan';

/** Body of POST /api/plans. */
export const GenerateRequestSchema = z.object({
  input: EventInputSchema,
  clientToday: isoDate,
});

/** Body of POST /api/plans/revise. */
export const ReviseRequestSchema = z.object({
  plan: PlanSchema,
  request: text(500, 3),
  clientToday: isoDate,
});
