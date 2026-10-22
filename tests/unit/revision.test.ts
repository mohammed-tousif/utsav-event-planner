import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/shared/dates';
import { applyManualChange, applyRevision, parseIntent, RevisionError } from '../../src/shared/revision';
import { budgetSum, makeInput, makePlan, makeRevision, TODAY } from '../fixtures';

const amount = (plan: ReturnType<typeof makePlan>, key: string) => plan.budget.lines.find((l) => l.key === key)!.amount;

describe('parseIntent', () => {
  const input = makeInput();

  it.each([
    ['Reduce the budget by 20%', 1_200_000],
    ['cut our total budget by 15 percent', 1_275_000],
    ['Increase the budget by 10%', 1_650_000],
    ['Set the budget to 12 lakh', 1_200_000],
    ['budget of ₹9,50,000 please', 950_000],
  ])('reads "%s" as a total of %i', (request, expected) => {
    expect(parseIntent(request, input).totalBudget).toBe(expected);
  });

  it('does not treat a category request as a change to the total', () => {
    expect(parseIntent('Reduce the decor budget by 20%', input).totalBudget).toBeUndefined();
    expect(parseIntent('Keep the venue budget unchanged but reduce decoration costs', input).totalBudget).toBeUndefined();
    expect(parseIntent('set the food budget to 2 lakh', input).totalBudget).toBeUndefined();
  });

  it.each([
    ['Increase the guest count from 250 to 300', 300],
    ['add 30 more guests', 280],
    ['we now expect 40 fewer people', 210],
    ['make it for 120 guests', 120],
  ])('reads "%s" as %i guests', (request, expected) => {
    expect(parseIntent(request, input).guestCount).toBe(expected);
  });

  it('notes when the user quotes a different starting guest count', () => {
    const intent = parseIntent('Increase the guest count from 50 to 80', input);
    expect(intent.guestCount).toBe(80);
    expect(intent.notes.join(' ')).toMatch(/had 250 guests, not 50/);
  });

  it('ignores impossible numbers', () => {
    expect(parseIntent('make it for 0 guests', input).guestCount).toBeUndefined();
    expect(parseIntent('make it for 99999 guests', input).guestCount).toBeUndefined();
    expect(parseIntent('reduce the budget by 100%', input).totalBudget).toBeUndefined();
  });
});

describe('applyRevision', () => {
  it('reduces the total by exactly 20% even if the model gets the maths wrong', () => {
    const plan = makePlan();
    const { plan: next, diff } = applyRevision(plan, makeRevision(plan, { totalBudget: 1_234_000 }), 'Reduce the budget by 20%', TODAY);
    expect(next.budget.total).toBe(1_200_000);
    expect(budgetSum(next)).toBe(1_200_000);
    expect(diff.totalBefore).toBe(1_500_000);
    expect(next.version).toBe(plan.version + 1);
    expect(next.revisions[0]!.changes[0]).toMatch(/exactly 20%/);
  });

  it('keeps the venue fixed and leaves other categories alone when only decor is reduced', () => {
    const plan = makePlan();
    const { plan: next } = applyRevision(
      plan,
      makeRevision(plan, {
        lockCategories: ['venue'],
        adjustments: [{ category: 'decor', factor: 0.6, reason: 'Simpler decor as requested.' }],
      }),
      'Keep the venue budget unchanged but reduce decoration costs',
      TODAY,
    );
    expect(amount(next, 'venue')).toBe(amount(plan, 'venue'));
    expect(next.budget.lines.find((l) => l.key === 'venue')!.locked).toBe(true);
    expect(amount(next, 'decor')).toBeLessThan(amount(plan, 'decor'));
    for (const key of ['catering', 'photo_video', 'invitations']) expect(amount(next, key)).toBe(amount(plan, key));
    expect(next.budget.contingency).toBeGreaterThan(plan.budget.contingency);
    expect(budgetSum(next)).toBe(plan.budget.total);
    expect(next.revisions[0]!.changes.join(' ')).toMatch(/freed and kept in contingency/);
  });

  it('keeps locked categories through later budget cuts', () => {
    const plan = makePlan();
    const locked = applyRevision(plan, makeRevision(plan, { lockCategories: ['venue'], adjustments: [{ category: 'decor', factor: 0.8, reason: '' }] }), 'keep venue, trim decor', TODAY).plan;
    const cut = applyRevision(locked, makeRevision(locked), 'Reduce the budget by 20%', TODAY).plan;
    expect(amount(cut, 'venue')).toBe(amount(plan, 'venue'));
    expect(budgetSum(cut)).toBe(1_200_000);
  });

  it('rebalances for more guests and keeps the total', () => {
    const plan = makePlan();
    const { plan: next } = applyRevision(plan, makeRevision(plan), 'Increase the guest count from 250 to 400', TODAY);
    expect(next.input.guestCount).toBe(400);
    expect(amount(next, 'catering')).toBeGreaterThan(amount(plan, 'catering'));
    expect(budgetSum(next)).toBe(plan.budget.total);
    expect(next.budget.perGuest).toBe(Math.round(plan.budget.total / 400));
  });

  it('re-dates tasks and vendors when the event moves to next week', () => {
    const plan = makePlan();
    plan.timeline.tasks[0]!.done = true;
    const nextWeek = addDays(TODAY, 7);
    const { plan: next } = applyRevision(plan, makeRevision(plan, { eventDate: nextWeek }), 'The event is now next week', TODAY);
    expect(next.input.eventDate).toBe(nextWeek);
    expect(next.timeline.tasks.every((t) => t.dueDate >= TODAY && t.dueDate <= nextWeek)).toBe(true);
    expect(next.vendors.every((v) => v.bookByDate >= TODAY && v.bookByDate <= nextWeek)).toBe(true);
    expect(next.timeline.tasks.find((t) => t.id === plan.timeline.tasks[0]!.id)!.done).toBe(true);
    expect(next.timeline.warnings.join(' ')).toMatch(/Only 7 days/);
  });

  it('rejects a revision that moves the event into the past', () => {
    const plan = makePlan();
    expect(() => applyRevision(plan, makeRevision(plan, { eventDate: '2026-01-01' }), 'move it to January', TODAY)).toThrow(RevisionError);
    expect(() => applyRevision(plan, makeRevision(plan, { eventDate: 'next friday' }), 'move it', TODAY)).toThrow(/could not be understood/);
  });

  it('reports when nothing would change', () => {
    const plan = makePlan();
    const attempt = () => applyRevision(plan, makeRevision(plan, { understood: 'I can only help with this event.' }), 'tell me a joke', TODAY);
    expect(attempt).toThrow(RevisionError);
    expect(attempt).toThrow('I can only help with this event.');
  });

  it('ignores out-of-range model values and categories from other event types', () => {
    const plan = makePlan();
    const { plan: next } = applyRevision(
      plan,
      makeRevision(plan, {
        totalBudget: -5,
        guestCount: 1.5,
        adjustments: [
          { category: 'sound_light', factor: 1.5, reason: 'not a wedding category' },
          { category: 'decor', factor: 40, reason: 'clamped' },
        ],
      }),
      'more decor please',
      TODAY,
    );
    expect(next.budget.total).toBe(plan.budget.total);
    expect(next.input.guestCount).toBe(plan.input.guestCount);
    expect(next.budget.lines.some((l) => l.key === 'sound_light')).toBe(false);
    expect(next.aiFactors.decor).toBeLessThanOrEqual(1.6);
    expect(budgetSum(next)).toBe(plan.budget.total);
  });

  it('replaces sections the model regenerates and keeps completed tasks', () => {
    const plan = makePlan();
    const firstTitle = plan.timeline.tasks[0]!.title;
    plan.timeline.tasks[0]!.done = true;
    const { plan: next, diff } = applyRevision(
      plan,
      makeRevision(plan, {
        regenerateTasks: true,
        tasks: [
          { title: firstTitle, area: 'other', offsetDays: 100, priority: 'high', notes: '' },
          { title: 'Arrange ramps and seating for elders', area: 'venue', offsetDays: 30, priority: 'high', notes: '' },
          { title: 'Plan a quiet rest room', area: 'venue', offsetDays: 20, priority: 'medium', notes: '' },
        ],
        regenerateIdeas: true,
        ideas: [
          { title: 'Seated aarti', description: 'd', whyItFits: 'w', estimatedCost: 5000, budgetCategory: 'ceremony', effort: 'low' },
          { title: 'Golf cart shuttle', description: 'd', whyItFits: 'w', estimatedCost: 900_000, budgetCategory: 'transport_stay', effort: 'medium' },
        ],
      }),
      'Make this suitable for older guests',
      TODAY,
    );
    expect(diff.regenerated).toEqual(['tasks', 'ideas']);
    expect(next.timeline.tasks).toHaveLength(3);
    expect(next.timeline.tasks.find((t) => t.title === firstTitle)!.done).toBe(true);
    expect(next.ideas.find((i) => i.title === 'Seated aarti')!.fitsBudget).toBe(true);
    expect(next.ideas.find((i) => i.title === 'Golf cart shuttle')!.fitsBudget).toBe(false);
  });

  it('refuses a revision whose locks cannot fit the new total', () => {
    const plan = makePlan();
    const locked = applyManualChange(plan, { lock: { key: 'catering', locked: true } }, TODAY).plan;
    expect(() => applyRevision(locked, makeRevision(locked), 'set the budget to 1 lakh', TODAY)).toThrow(/Unlock a category/);
  });
});

describe('applyManualChange', () => {
  it('recalculates without AI and records the change', () => {
    const plan = makePlan();
    const { plan: next } = applyManualChange(plan, { guestCount: 300, totalBudget: 1_800_000, contingencyPct: 12 }, TODAY);
    expect(next.input.guestCount).toBe(300);
    expect(budgetSum(next)).toBe(1_800_000);
    expect(next.budget.contingencyPct).toBe(12);
    expect(next.revisions[0]!.kind).toBe('manual');
  });

  it('locks and unlocks a category', () => {
    const plan = makePlan();
    const locked = applyManualChange(plan, { lock: { key: 'venue', locked: true } }, TODAY).plan;
    expect(locked.budget.lines.find((l) => l.key === 'venue')!.locked).toBe(true);
    const cut = applyManualChange(locked, { totalBudget: 1_000_000 }, TODAY).plan;
    expect(amount(cut, 'venue')).toBe(amount(plan, 'venue'));
    const unlocked = applyManualChange(cut, { lock: { key: 'venue', locked: false } }, TODAY).plan;
    expect(unlocked.budget.lines.find((l) => l.key === 'venue')!.locked).toBe(false);
  });

  it.each([
    [{ guestCount: 0 }, /whole number/],
    [{ guestCount: 12.5 }, /whole number/],
    [{ totalBudget: -100 }, /greater than zero/],
    [{ eventDate: '2020-01-01' }, /past/],
  ])('rejects %o', (change, message) => {
    expect(() => applyManualChange(makePlan(), change, TODAY)).toThrow(message);
  });
});
