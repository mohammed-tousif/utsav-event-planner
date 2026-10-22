import { addDays, daysBetween } from './dates';
import type { AiScheduleItemSchema, AiTaskSchema, ScheduleItem, Task } from './schemas';
import type { z } from 'zod';
import { MAX_DAYS_AHEAD } from './constants';

type AiTask = z.output<typeof AiTaskSchema>;
type AiScheduleItem = z.output<typeof AiScheduleItemSchema>;

export const MAX_TASK_OFFSET = 730;

export class DateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateRangeError';
  }
}

/** Validates the event date against today. Returns days until the event. */
export function checkEventDate(eventDate: string, today: string): number {
  const days = daysBetween(today, eventDate);
  if (days < 0) throw new DateRangeError('The event date is in the past. Choose today or a later date.');
  if (days > MAX_DAYS_AHEAD) throw new DateRangeError('Choose a date within the next three years.');
  return days;
}

/**
 * Fits ideal "days before the event" offsets into the time actually left.
 *
 * Tasks that still fit in the first half of the remaining window keep their
 * ideal dates. Tasks that would already be overdue are squeezed, in order,
 * into the earlier part of the window, so the most lead-time-hungry work is
 * scheduled first and the original order is preserved.
 */
export function compressOffsets(idealOffsets: readonly number[], daysUntil: number): number[] {
  const maxOffset = Math.max(0, ...idealOffsets);
  if (maxOffset <= daysUntil) return [...idealOffsets];
  const keepUpTo = Math.floor(daysUntil / 2);
  return idealOffsets.map((offset) => {
    if (offset <= keepUpTo) return offset;
    const span = maxOffset - keepUpTo;
    const room = daysUntil - keepUpTo;
    return keepUpTo + Math.round(((offset - keepUpTo) * room) / span);
  });
}

function sanitizeOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_TASK_OFFSET, Math.max(0, Math.round(value)));
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export interface TaskSeed extends AiTask {
  id?: string;
  done?: boolean;
}

/** Builds dated tasks from ideal offsets; recomputed whenever the date changes. */
export function scheduleTasks(seeds: readonly TaskSeed[], eventDate: string, today: string, newId: () => string): Task[] {
  const daysUntil = checkEventDate(eventDate, today);
  const unique = dedupeByTitle(seeds);
  const ideal = unique.map((seed) => sanitizeOffset(seed.offsetDays));
  const fitted = compressOffsets(ideal, daysUntil);
  const tasks = unique.map((seed, index): Task => {
    const offsetDays = fitted[index] ?? 0;
    const idealOffsetDays = ideal[index] ?? 0;
    return {
      id: seed.id ?? newId(),
      title: seed.title,
      area: seed.area,
      priority: seed.priority,
      notes: seed.notes,
      idealOffsetDays,
      offsetDays,
      dueDate: addDays(eventDate, -offsetDays),
      compressed: offsetDays < idealOffsetDays,
      done: seed.done ?? false,
    };
  });
  return tasks.sort(
    (a, b) => b.offsetDays - a.offsetDays || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

function dedupeByTitle<T extends { title: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (!item.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function timelineWarnings(eventType: string, daysUntil: number, tasks: readonly Task[]): string[] {
  const warnings: string[] = [];
  const compressed = tasks.filter((task) => task.compressed).length;
  if (daysUntil === 0) warnings.push('The event is today. Only the event-day schedule and urgent tasks still apply.');
  else if (daysUntil <= 7) warnings.push(`Only ${daysUntil} day${daysUntil === 1 ? '' : 's'} to go. Lock the venue, food and key vendors first.`);
  if (compressed > 0) {
    warnings.push(
      `${compressed} task${compressed === 1 ? ' was' : 's were'} brought forward because the event is sooner than their usual lead time.`,
    );
  }
  if (eventType === 'wedding' && daysUntil < 60 && daysUntil > 0) {
    warnings.push('Popular wedding vendors are often booked months ahead. Contact several at once.');
  }
  return warnings;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Orders the event-day schedule and flags items that overlap in a segment. */
export function buildSchedule(items: readonly AiScheduleItem[], newId: () => string): ScheduleItem[] {
  const segmentOrder = new Map<string, number>();
  for (const item of items) if (!segmentOrder.has(item.segment)) segmentOrder.set(item.segment, segmentOrder.size);

  const sorted = items
    .filter((item) => item.title)
    .map((item) => ({
      id: newId(),
      segment: item.segment || 'Event day',
      time: item.time,
      durationMin: Math.min(600, Math.max(5, Math.round(Number.isFinite(item.durationMin) ? item.durationMin : 30))),
      title: item.title,
      notes: item.notes,
      overlaps: false,
    }))
    .sort(
      (a, b) =>
        (segmentOrder.get(a.segment) ?? 0) - (segmentOrder.get(b.segment) ?? 0) || toMinutes(a.time) - toMinutes(b.time),
    );

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const current = sorted[i];
    if (!prev || !current || prev.segment !== current.segment) continue;
    if (toMinutes(prev.time) + prev.durationMin > toMinutes(current.time)) {
      prev.overlaps = true;
      current.overlaps = true;
    }
  }
  return sorted;
}

export type TaskPhase = 'early' | 'months' | 'weeks' | 'final_week' | 'event_day';

export const PHASE_LABELS: Record<TaskPhase, string> = {
  early: 'More than three months before',
  months: 'One to three months before',
  weeks: 'Two to four weeks before',
  final_week: 'Final two weeks',
  event_day: 'On the day',
};

export function phaseFor(offsetDays: number): TaskPhase {
  if (offsetDays === 0) return 'event_day';
  if (offsetDays <= 14) return 'final_week';
  if (offsetDays <= 30) return 'weeks';
  if (offsetDays <= 90) return 'months';
  return 'early';
}
