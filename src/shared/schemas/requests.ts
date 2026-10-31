/** API request bodies. */
import { z } from 'zod';
import { isoDate, text } from './fields';
import { EventInputSchema } from './input';
import { PlanSchema } from './plan';

export const GenerateRequestSchema = z.object({
  input: EventInputSchema,
  clientToday: isoDate,
});

export const ReviseRequestSchema = z.object({
  plan: PlanSchema,
  request: text(500, 3),
  clientToday: isoDate,
});
