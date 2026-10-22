import { describe, expect, it } from 'vitest';
import { intakeChecks } from '../../src/shared/intake';
import { AiPlanDraftSchema, EventInputSchema, PlanSchema } from '../../src/shared/schemas';
import { cleanText, clip } from '../../src/shared/text';
import { sampleDraft } from '../../src/server/ai/sample';
import { makeInput, makePlan, TODAY } from '../fixtures';

const valid = {
  eventType: 'birthday',
  eventDate: '2026-12-05',
  guestCount: 40,
  totalBudget: 60_000,
  currency: 'INR',
  city: 'Dharwad',
  style: 'Jungle safari',
  priorities: ['entertainment'],
  venueStatus: 'booked',
  birthday: { ageGroup: 'child', audience: 'kids', honoreeName: 'Ayaan' },
};

const issues = (value: unknown) => {
  const result = EventInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('EventInputSchema', () => {
  it('accepts a complete birthday', () => {
    expect(issues(valid)).toEqual([]);
  });

  it.each([
    [{ guestCount: 0 }, 'guestCount'],
    [{ guestCount: -4 }, 'guestCount'],
    [{ guestCount: 12.5 }, 'guestCount'],
    [{ guestCount: 10_000 }, 'guestCount'],
    [{ totalBudget: 0 }, 'totalBudget'],
    [{ totalBudget: -1000 }, 'totalBudget'],
    [{ totalBudget: Number.NaN }, 'totalBudget'],
    [{ eventDate: '2026-02-30' }, 'eventDate'],
    [{ eventDate: 'next week' }, 'eventDate'],
    [{ currency: 'XYZ' }, 'currency'],
    [{ city: ' ' }, 'city'],
    [{ style: 'x'.repeat(500) }, 'style'],
    [{ eventType: 'funeral' }, 'eventType'],
  ])('rejects %o', (patch, field) => {
    expect(issues({ ...valid, ...patch }).some((i) => i.startsWith(field))).toBe(true);
  });

  it('requires the follow-up details for the chosen event type', () => {
    expect(issues({ ...valid, birthday: undefined }).join()).toMatch(/birthday/);
    expect(issues({ ...valid, eventType: 'wedding', birthday: undefined }).join()).toMatch(/wedding/);
    expect(issues({ ...valid, eventType: 'wedding', wedding: { functions: [], days: 1 } }).join()).toMatch(/at least one function/);
  });

  it('drops details that belong to another event type', () => {
    const parsed = EventInputSchema.parse({ ...valid, community: { format: 'meetup', setting: 'indoor', entry: 'free' } });
    expect(parsed.community).toBeUndefined();
    expect(parsed.birthday?.honoreeName).toBe('Ayaan');
  });

  it('cleans control characters and limits priorities to three', () => {
    const parsed = EventInputSchema.parse({ ...valid, city: '  Dharwad\u0000​  ', priorities: ['food', 'decor', 'food', 'venue'] });
    expect(parsed.city).toBe('Dharwad');
    expect(parsed.priorities).toEqual(['food', 'decor', 'venue']);
    expect(issues({ ...valid, priorities: ['food', 'decor', 'venue', 'attire'] }).length).toBeGreaterThan(0);
  });
});

describe('AI output validation', () => {
  it('accepts the sample draft', () => {
    expect(AiPlanDraftSchema.safeParse(sampleDraft(makeInput())).success).toBe(true);
  });

  it('rejects malformed drafts', () => {
    const draft = sampleDraft(makeInput());
    expect(AiPlanDraftSchema.safeParse({ ...draft, tasks: [] }).success).toBe(false);
    expect(AiPlanDraftSchema.safeParse({ ...draft, ideas: 'none' }).success).toBe(false);
    expect(AiPlanDraftSchema.safeParse({ ...draft, schedule: [{ ...draft.schedule[0], time: '7pm' }, draft.schedule[1]] }).success).toBe(false);
    expect(AiPlanDraftSchema.safeParse({ ...draft, adjustments: [{ category: 'yachts', factor: 1, reason: '' }] }).success).toBe(false);
  });

  it('cleans and truncates long model text', () => {
    const draft = sampleDraft(makeInput());
    const parsed = AiPlanDraftSchema.parse({ ...draft, summary: `Hello\u0007 ${'very '.repeat(200)}` });
    expect(parsed.summary.length).toBeLessThanOrEqual(500);
    expect(parsed.summary).not.toContain('\u0007');
  });
});

describe('PlanSchema', () => {
  it('round-trips a saved plan through JSON', () => {
    const plan = makePlan();
    const parsed = PlanSchema.safeParse(JSON.parse(JSON.stringify(plan)));
    expect(parsed.success).toBe(true);
  });

  it('rejects a tampered plan', () => {
    const plan = JSON.parse(JSON.stringify(makePlan()));
    plan.budget.lines[0].amount = -1;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe('text helpers', () => {
  it('normalises whitespace and keeps paragraphs when asked', () => {
    expect(cleanText('  a \t b  ')).toBe('a b');
    expect(cleanText('line one\n\n\n\nline two', { multiline: true })).toBe('line one\n\nline two');
    expect(clip('the quick brown fox jumps', 12)).toBe('the quick…');
  });
});

describe('intakeChecks', () => {
  it('flags short notice, a missing venue and a tight budget', () => {
    const input = makeInput({ eventDate: '2026-10-25', venueStatus: 'not_started', totalBudget: 100_000, guestCount: 300 });
    expect(intakeChecks(input, TODAY).map((c) => c.code)).toEqual(['short_notice', 'venue_first', 'tight_budget']);
  });

  it('has nothing to say about a comfortable, well-timed plan', () => {
    expect(intakeChecks(makeInput(), TODAY)).toEqual([]);
  });
});
