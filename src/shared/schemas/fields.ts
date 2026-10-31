/** Shared field helpers for untrusted text, dates and lists. */
import { z } from 'zod';
import { isISODate } from '../dates';
import { cleanText } from '../text';

/** Untrusted single-line text: cleaned, then length-checked. */
export const text = (max: number, min = 0) =>
  z
    .string()
    .transform((value) => cleanText(value))
    .pipe(
      z
        .string()
        .min(min, min === 1 ? 'This field is required.' : `Use at least ${min} characters.`)
        .max(max, `Keep this under ${max} characters.`),
    );

/** Untrusted multi-line text: cleaned, then length-checked. */
export const multilineText = (max: number) =>
  z
    .string()
    .transform((value) => cleanText(value, { multiline: true }))
    .pipe(z.string().max(max, `Keep this under ${max} characters.`));

/** A real calendar date in YYYY-MM-DD form. */
export const isoDate = z.string().refine(isISODate, 'Use a valid date in YYYY-MM-DD format.');

/** A list with duplicates removed, then limited in length. */
export const uniqueArray = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(50)
    .transform((values) => [...new Set(values)] as z.output<T>[])
    .refine((values) => values.length <= max, `Choose up to ${max}.`);
