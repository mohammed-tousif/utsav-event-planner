import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isISODate, todayISO } from '../../src/shared/dates';
import {
  buildSchedule,
  checkEventDate,
  compressOffsets,
  DateRangeError,
  phaseFor,
  scheduleTasks,
  timelineWarnings,
  type TaskSeed,
} from '../../src/shared/timeline';
import { TODAY } from '../fixtures';

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

const seed = (title: string, offsetDays: number, priority: TaskSeed['priority'] = 'medium'): TaskSeed => ({
  title,
  offsetDays,
  priority,
  area: 'other',
  notes: '',
});

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isISODate('2027-02-28')).toBe(true);
    expect(isISODate('2027-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isISODate('27-2-2027')).toBe(false);
  });

  it('adds and diffs days across months and years in UTC', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-22', '2027-02-14')).toBe(115);
    expect(daysBetween('2027-02-14', '2026-10-22')).toBe(-115);
  });

  it('formats today in a given time zone', () => {
    const late = new Date('2026-10-22T20:00:00Z');
    expect(todayISO('UTC', late)).toBe('2026-10-22');
    expect(todayISO('Asia/Kolkata', late)).toBe('2026-10-23');
  });
});

describe('checkEventDate', () => {
  it('rejects past dates and dates more than three years away', () => {
    expect(() => checkEventDate('2026-10-21', TODAY)).toThrow(DateRangeError);
    expect(() => checkEventDate(addDays(TODAY, 1200), TODAY)).toThrow(DateRangeError);
    expect(checkEventDate(TODAY, TODAY)).toBe(0);
    expect(checkEventDate('2026-10-29', TODAY)).toBe(7);
  });
});

describe('compressOffsets', () => {
  it('keeps ideal offsets when there is enough time', () => {
    expect(compressOffsets([180, 30, 0], 200)).toEqual([180, 30, 0]);
  });

  it('fits every task inside the time left and preserves order', () => {
    const ideal = [180, 150, 120, 90, 45, 30, 7, 1, 0];
    const fitted = compressOffsets(ideal, 20);
    expect(Math.max(...fitted)).toBeLessThanOrEqual(20);
    expect(fitted.every((v) => v >= 0)).toBe(true);
    for (let i = 1; i < fitted.length; i += 1) expect(fitted[i]!).toBeLessThanOrEqual(fitted[i - 1]!);
    expect(fitted.at(-1)).toBe(0);
  });

  it('puts everything on the day for an event today', () => {
    expect(compressOffsets([30, 7, 0], 0)).toEqual([0, 0, 0]);
  });
});

describe('scheduleTasks', () => {
  it('dates tasks relative to the event and sorts them earliest first', () => {
    const tasks = scheduleTasks([seed('Order cake', 7), seed('Book venue', 30, 'high')], '2026-12-31', TODAY, newId);
    expect(tasks.map((t) => t.title)).toEqual(['Book venue', 'Order cake']);
    expect(tasks[0]!.dueDate).toBe('2026-12-01');
    expect(tasks[1]!.dueDate).toBe('2026-12-24');
    expect(tasks.every((t) => !t.compressed)).toBe(true);
  });

  it('brings tasks forward for an event next week and never dates them in the past', () => {
    const eventDate = addDays(TODAY, 7);
    const tasks = scheduleTasks([seed('Book venue', 120), seed('Send invites', 30), seed('Final count', 3)], eventDate, TODAY, newId);
    for (const task of tasks) {
      expect(daysBetween(TODAY, task.dueDate)).toBeGreaterThanOrEqual(0);
      expect(daysBetween(task.dueDate, eventDate)).toBeGreaterThanOrEqual(0);
    }
    expect(tasks.filter((t) => t.compressed).map((t) => t.title)).toEqual(['Book venue', 'Send invites']);
  });

  it('cleans up model output: removes duplicates and clamps odd offsets', () => {
    const tasks = scheduleTasks(
      [seed('Book venue', 30), seed('book venue', 20), seed('Strange', -5), seed('Far', 99_999), seed('', 10)],
      addDays(TODAY, 1000),
      TODAY,
      newId,
    );
    expect(tasks.map((t) => t.title).sort()).toEqual(['Book venue', 'Far', 'Strange']);
    expect(tasks.find((t) => t.title === 'Strange')!.offsetDays).toBe(0);
    expect(tasks.find((t) => t.title === 'Far')!.idealOffsetDays).toBe(730);
  });

  it('keeps ids and done state when rescheduling', () => {
    const tasks = scheduleTasks([{ ...seed('Book venue', 30), id: 'keep-me', done: true }], '2027-01-31', TODAY, newId);
    expect(tasks[0]).toMatchObject({ id: 'keep-me', done: true });
  });
});

describe('buildSchedule', () => {
  it('orders items by segment then time and flags overlaps', () => {
    const items = buildSchedule(
      [
        { segment: 'Reception', time: '20:00', durationMin: 60, title: 'Dinner', notes: '' },
        { segment: 'Ceremony', time: '10:00', durationMin: 120, title: 'Pheras', notes: '' },
        { segment: 'Ceremony', time: '11:00', durationMin: 30, title: 'Photos', notes: '' },
        { segment: 'Reception', time: '19:00', durationMin: 30, title: 'Entry', notes: '' },
      ],
      newId,
    );
    expect(items.map((i) => i.title)).toEqual(['Entry', 'Dinner', 'Pheras', 'Photos']);
    expect(items.find((i) => i.title === 'Pheras')!.overlaps).toBe(true);
    expect(items.find((i) => i.title === 'Entry')!.overlaps).toBe(false);
  });

  it('clamps durations to sensible bounds', () => {
    const [item] = buildSchedule([{ segment: 'Day', time: '09:00', durationMin: -10, title: 'Setup', notes: '' }], newId);
    expect(item!.durationMin).toBe(5);
  });
});

describe('timelineWarnings and phases', () => {
  it('warns about very short notice and compressed tasks', () => {
    const tasks = scheduleTasks([seed('Book venue', 120)], addDays(TODAY, 3), TODAY, newId);
    const warnings = timelineWarnings('wedding', 3, tasks);
    expect(warnings.join(' ')).toMatch(/Only 3 days/);
    expect(warnings.join(' ')).toMatch(/brought forward/);
    expect(timelineWarnings('birthday', 0, [])[0]).toMatch(/today/);
  });

  it('groups offsets into phases', () => {
    expect([200, 60, 20, 5, 0].map(phaseFor)).toEqual(['early', 'months', 'weeks', 'final_week', 'event_day']);
  });
});
