import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  errorsForStep,
  positiveNumber,
  restoreDraft,
  stepsWithErrors,
  toInput,
  validate,
  type Draft,
} from '../../src/client/components/intake/draft';
import { TODAY } from '../fixtures';

const complete: Draft = {
  ...EMPTY_DRAFT,
  eventType: 'wedding',
  title: 'Asha and Rohan’s wedding',
  eventDate: '2027-02-14',
  guestCount: '250',
  totalBudget: '15,00,000',
  city: 'Hubballi, Karnataka',
  style: 'Pastel garden',
  priorities: ['food'],
  venueStatus: 'shortlisted',
  weddingFunctions: ['ceremony', 'reception'],
  weddingDays: '2',
};

describe('intake draft', () => {
  it('turns a complete draft into a valid event, reading Indian-style numbers', () => {
    const { input, errors } = validate(complete, TODAY);
    expect(errors).toEqual({});
    expect(input).toMatchObject({ guestCount: 250, totalBudget: 1_500_000, wedding: { days: 2 } });
  });

  it('explains every missing field in plain words and assigns it to the right step', () => {
    const { input, errors } = validate({ ...EMPTY_DRAFT, eventType: 'birthday' }, TODAY);
    expect(input).toBeUndefined();
    expect(errors).toMatchObject({
      eventDate: 'Choose the event date.',
      guestCount: 'Enter the number of guests.',
      totalBudget: 'Enter a total budget.',
      priorities: 'Pick at least one thing that matters most.',
      birthday: 'Tell us who the birthday is for and who is coming.',
    });
    expect(Object.keys(errorsForStep('basics', errors))).toEqual(expect.arrayContaining(['eventDate', 'guestCount']));
    expect(Object.keys(errorsForStep('details', errors))).toEqual(['birthday']);
    expect(stepsWithErrors(errors)).toEqual(['basics', 'budget', 'details', 'preferences']);
  });

  it('rejects past dates and dates more than three years away', () => {
    expect(validate({ ...complete, eventDate: '2026-10-01' }, TODAY).errors.eventDate).toMatch(/passed/);
    expect(validate({ ...complete, eventDate: '2030-01-01' }, TODAY).errors.eventDate).toMatch(/three years/);
  });

  it('asks for all three community answers', () => {
    const { errors } = validate({ ...complete, eventType: 'community', format: 'festival' }, TODAY);
    expect(errors.community).toBe('Answer all three questions about the event.');
  });

  it('only sends the details block for the chosen event type', () => {
    expect(toInput(complete)).toMatchObject({
      wedding: { functions: ['ceremony', 'reception'] },
      birthday: undefined,
      community: undefined,
    });
    expect(toInput({ ...complete, eventType: 'birthday' }).wedding).toBeUndefined();
  });

  it('reads positive numbers only', () => {
    expect(positiveNumber('1,200')).toBe(1200);
    expect(positiveNumber('0')).toBeUndefined();
    expect(positiveNumber('')).toBeUndefined();
  });

  it('restores a saved draft but drops fields with the wrong shape', () => {
    const restored = restoreDraft({ city: 'Hubballi', guestCount: 250, priorities: ['food', 3], unknown: 'x' });
    expect(restored.city).toBe('Hubballi');
    expect(restored.guestCount).toBe('');
    expect(restored.priorities).toEqual([]);
    expect(restored).not.toHaveProperty('unknown');
    expect(restoreDraft(null)).toEqual(EMPTY_DRAFT);
  });
});
