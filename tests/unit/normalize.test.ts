import { describe, expect, it } from 'vitest';
import { normalizeModelJson, normalizeTime } from '../../src/server/ai/normalize';
import { AiPlanDraftSchema } from '../../src/shared/schemas';
import { sampleDraft } from '../../src/server/ai/sample';
import { makeInput } from '../fixtures';

describe('normalizeTime', () => {
  it.each([
    ['7:00', '07:00'],
    ['19:30', '19:30'],
    ['7 pm', '19:00'],
    ['07:30 PM', '19:30'],
    ['12:15 a.m.', '00:15'],
    ['12 pm', '12:00'],
    ['18:00:00', '18:00'],
  ])('reads %s as %s', (input, expected) => expect(normalizeTime(input)).toBe(expected));

  it.each(['25:00', 'evening', '', '7:75'])('rejects %s', (input) => expect(normalizeTime(input)).toBeUndefined());
});

describe('normalizeModelJson', () => {
  it('repairs common deviations so a slightly-off reply still validates', () => {
    const draft = sampleDraft(makeInput()) as unknown as Record<string, unknown>;
    const messy = {
      ...draft,
      contingencyPct: '10%',
      adjustments: [{ category: 'decor', factor: '1.2', reason: 'x' }, { category: 'fireworks', factor: 2, reason: 'y' }],
      tasks: (draft.tasks as object[]).map((t) => ({ ...t, area: 'misc', priority: 'urgent', offsetDays: '30' })),
      schedule: [
        { segment: 'Reception', time: '7 pm', durationMin: '60', title: 'Dinner' },
        { segment: 'Reception', time: 'later', durationMin: 30, title: 'Dropped', notes: '' },
        { time: '9:00', durationMin: 30, title: 'Breakfast' },
      ],
      vendors: [{ category: 'caterer', questions: ['Q?', 5] }, { category: 'astrologer', why: 'no' }],
      ideas: (draft.ideas as object[]).map((i) => ({ ...i, effort: 'tiny', budgetCategory: 'misc', estimatedCost: '₹5,000' })),
    };
    const parsed = AiPlanDraftSchema.safeParse(normalizeModelJson(messy));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.contingencyPct).toBe(10);
    expect(parsed.data.adjustments.map((a) => a.category)).toEqual(['decor']);
    expect(parsed.data.tasks.every((t) => t.area === 'other' && t.priority === 'medium' && t.offsetDays === 30)).toBe(true);
    expect(parsed.data.schedule.map((s) => s.time)).toEqual(['19:00', '09:00']);
    expect(parsed.data.vendors).toEqual([{ category: 'caterer', why: '', questions: ['Q?'], compareOn: [], redFlags: [] }]);
    expect(parsed.data.ideas.every((i) => i.effort === 'medium' && i.budgetCategory === 'decor' && i.estimatedCost === 5000)).toBe(true);
  });

  it('leaves non-objects alone for validation to reject', () => {
    expect(normalizeModelJson('nope')).toBe('nope');
    expect(AiPlanDraftSchema.safeParse(normalizeModelJson([1, 2])).success).toBe(false);
  });
});
