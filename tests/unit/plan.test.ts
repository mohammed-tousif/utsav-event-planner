import { describe, expect, it } from 'vitest';
import { categoriesFor, EVENT_TYPES } from '../../src/shared/constants';
import { addDays } from '../../src/shared/dates';
import { assemblePlan, buildVendors } from '../../src/shared/plan';
import { sampleDraft } from '../../src/server/ai/sample';
import { vendorTemplatesFor } from '../../src/shared/vendorCatalog';
import { budgetSum, makeInput, makePlan, TODAY } from '../fixtures';
import { icsEscape, planToIcs } from '../../src/client/lib/export';

const meta = { source: 'ai' as const, provider: 'Google Gemini', model: 'test', generatedAt: '2026-10-22T00:00:00Z' };

describe('assemblePlan', () => {
  it.each(EVENT_TYPES)('builds a consistent %s plan with all four outputs', (eventType) => {
    const input = makeInput({
      eventType,
      wedding: eventType === 'wedding' ? { functions: ['ceremony'], days: 1 } : undefined,
      birthday: eventType === 'birthday' ? { ageGroup: 'child', audience: 'kids', honoreeName: '' } : undefined,
      community: eventType === 'community' ? { format: 'festival', setting: 'outdoor', entry: 'free' } : undefined,
    });
    const plan = makePlan(input);
    expect(budgetSum(plan)).toBe(input.totalBudget);
    expect(plan.budget.lines.map((l) => l.key)).toEqual(categoriesFor(eventType));
    expect(plan.timeline.tasks.length).toBeGreaterThan(0);
    expect(plan.timeline.schedule.length).toBeGreaterThan(0);
    expect(plan.vendors.map((v) => v.key)).toEqual(vendorTemplatesFor(eventType).map((t) => t.key));
    expect(plan.ideas.length).toBeGreaterThan(0);
  });

  it('applies the model’s adjustments and clamps its contingency', () => {
    const input = makeInput();
    const draft = { ...sampleDraft(input), contingencyPct: 45, adjustments: [{ category: 'photo_video' as const, factor: 1.5, reason: 'Photos are a top priority.' }] };
    const plan = assemblePlan(input, draft, meta, TODAY);
    expect(plan.budget.contingencyPct).toBe(15);
    expect(plan.budget.lines.find((l) => l.key === 'photo_video')!.rationale).toBe('Photos are a top priority.');
    expect(plan.meta.source).toBe('ai');
  });

  it('refuses to plan an event in the past', () => {
    const input = makeInput({ eventDate: '2026-10-01' });
    expect(() => assemblePlan(input, sampleDraft(input), meta, TODAY)).toThrow(/past/);
  });
});

describe('buildVendors', () => {
  it('always covers the standard checklist and drops categories from other event types', () => {
    const input = makeInput();
    const vendors = buildVendors(
      input,
      [
        { category: 'caterer', why: 'Jain and vegetarian menus need a specialist.', questions: ['Do you cook Jain food separately?'], compareOn: ['Jain experience'], redFlags: [] },
        { category: 'cake_baker', why: 'Not a wedding vendor here.', questions: [], compareOn: [], redFlags: [] },
      ],
      TODAY,
    );
    expect(vendors.find((v) => v.key === 'caterer')).toMatchObject({ source: 'ai', questions: ['Do you cook Jain food separately?'] });
    expect(vendors.find((v) => v.key === 'cake_baker')).toBeUndefined();
    expect(vendors.find((v) => v.key === 'photographer')!.source).toBe('standard');
  });

  it('marks a booked venue and keeps booking dates inside the time left', () => {
    const input = makeInput({ venueStatus: 'booked', eventDate: addDays(TODAY, 10) });
    const vendors = buildVendors(input, [], TODAY);
    expect(vendors.find((v) => v.key === 'venue')!.status).toBe('booked');
    expect(vendors.every((v) => v.bookByDate >= TODAY && v.bookByDate <= input.eventDate)).toBe(true);
  });
});

describe('calendar export', () => {
  it('escapes special characters', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('creates a valid calendar with the event and open tasks', () => {
    const plan = makePlan();
    plan.timeline.tasks[0]!.done = true;
    const ics = planToIcs(plan, new Date('2026-10-22T10:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(plan.timeline.tasks.length);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270214');
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});
