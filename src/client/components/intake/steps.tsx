import {
  ACCESSIBILITY_KEYS,
  ACCESSIBILITY_LABELS,
  CURRENCIES,
  DIETARY_KEYS,
  DIETARY_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  MAX_DAYS_AHEAD,
  PRIORITY_KEYS,
  PRIORITY_LABELS,
  VENUE_STATUSES,
  VENUE_STATUS_LABELS,
  type Currency,
} from '../../../shared/constants';
import { addDays } from '../../../shared/dates';
import { formatMoney } from '../../../shared/money';
import { navigate } from '../../lib/hooks';
import { ChoiceGroup, controlProps, digitsOnly, Field } from '../fields';
import type { Draft } from './draft';
import { positiveNumber } from './draft';
import type { SetField } from './useIntakeForm';

/** What every step of the form receives. */
export interface StepProps {
  draft: Draft;
  set: SetField;
  /** The error currently shown for a field, if any. */
  error: (key: string) => string | undefined;
  today: string;
}

function DateAndGuests({ draft, set, error, today }: StepProps) {
  return (
    <div className="field-row">
      <Field label="Event date" error={error('eventDate')}>
        {(p) => (
          <input
            {...controlProps(p)}
            type="date"
            value={draft.eventDate}
            min={today}
            max={addDays(today, MAX_DAYS_AHEAD)}
            onChange={(e) => set('eventDate', e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Number of guests" error={error('guestCount')}>
        {(p) => (
          <input
            {...controlProps(p)}
            inputMode="numeric"
            value={draft.guestCount}
            onChange={(e) => set('guestCount', digitsOnly(e.target.value))}
            placeholder="150"
            required
          />
        )}
      </Field>
    </div>
  );
}

export function BasicsStep({ draft, set, error, today }: StepProps) {
  return (
    <>
      <ChoiceGroup
        legend="What kind of event?"
        type="radio"
        name="eventType"
        options={EVENT_TYPES}
        labels={EVENT_TYPE_LABELS}
        value={draft.eventType ? [draft.eventType] : []}
        onChange={([v]) => {
          set('eventType', v ?? '');
          if (v) navigate(`/new/${v}`);
        }}
        error={error('eventType') && 'Choose the kind of event.'}
      />
      <Field
        label="Event name"
        optional
        hint="Shown at the top of your plan, for example “Asha and Rohan’s wedding”."
        error={error('title')}
      >
        {(p) => (
          <input
            {...controlProps(p)}
            value={draft.title}
            maxLength={80}
            onChange={(e) => set('title', e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>
      <DateAndGuests draft={draft} set={set} error={error} today={today} />
      <Field
        label="City or area"
        hint="Used to suggest local customs and realistic costs. No vendor lookups are made."
        error={error('city')}
      >
        {(p) => (
          <input
            {...controlProps(p)}
            value={draft.city}
            maxLength={80}
            onChange={(e) => set('city', e.target.value)}
            placeholder="Hubballi, Karnataka"
            autoComplete="address-level2"
            required
          />
        )}
      </Field>
      <ChoiceGroup
        legend="Venue"
        type="radio"
        name="venueStatus"
        options={VENUE_STATUSES}
        labels={VENUE_STATUS_LABELS}
        value={draft.venueStatus ? [draft.venueStatus] : []}
        onChange={([v]) => set('venueStatus', v ?? '')}
        error={error('venueStatus') && 'Tell us where the venue stands.'}
      />
    </>
  );
}

function budgetHint(draft: Draft): string {
  const budget = positiveNumber(draft.totalBudget);
  if (!budget) return 'Everything included: venue, food, decor and the rest.';
  const guests = positiveNumber(draft.guestCount);
  const perGuest = guests ? `, about ${formatMoney(budget / guests, draft.currency)} per guest` : '';
  return `${formatMoney(budget, draft.currency)}${perGuest}`;
}

export function BudgetStep({ draft, set, error }: StepProps) {
  return (
    <>
      <div className="field-row budget-row">
        <Field label="Total budget" hint={budgetHint(draft)} error={error('totalBudget')}>
          {(p) => (
            <input
              {...controlProps(p)}
              inputMode="numeric"
              value={draft.totalBudget}
              onChange={(e) => set('totalBudget', digitsOnly(e.target.value))}
              placeholder="800000"
              required
            />
          )}
        </Field>
        <Field label="Currency" error={error('currency')}>
          {(p) => (
            <select
              id={p.id}
              aria-describedby={p.describedBy}
              value={draft.currency}
              onChange={(e) => set('currency', e.target.value as Currency)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <ChoiceGroup
        legend="What matters most?"
        hint="Pick up to three. These get a bigger share of the budget."
        type="checkbox"
        name="priorities"
        options={PRIORITY_KEYS}
        labels={PRIORITY_LABELS}
        value={draft.priorities as never}
        onChange={(v) => set('priorities', v)}
        max={3}
        error={error('priorities')}
      />
    </>
  );
}

export function PreferencesStep({ draft, set, error }: StepProps) {
  return (
    <>
      <Field
        label="Style or theme"
        hint="A few words is enough, for example “South Indian temple style in gold and maroon”."
        error={error('style')}
      >
        {(p) => <input {...controlProps(p)} value={draft.style} maxLength={120} onChange={(e) => set('style', e.target.value)} required />}
      </Field>
      <ChoiceGroup
        legend="Food needs"
        optional
        type="checkbox"
        name="dietary"
        options={DIETARY_KEYS}
        labels={DIETARY_LABELS}
        value={draft.dietary as never}
        onChange={(v) => set('dietary', v)}
      />
      <ChoiceGroup
        legend="Accessibility and comfort"
        optional
        type="checkbox"
        name="accessibility"
        options={ACCESSIBILITY_KEYS}
        labels={ACCESSIBILITY_LABELS}
        value={draft.accessibility as never}
        onChange={(v) => set('accessibility', v)}
      />
      <Field
        label="Cultural or religious customs"
        optional
        hint="Rituals, timings or traditions the plan should respect."
        error={error('culturalNotes')}
      >
        {(p) => (
          <textarea
            id={p.id}
            aria-describedby={p.describedBy}
            rows={3}
            maxLength={300}
            value={draft.culturalNotes}
            onChange={(e) => set('culturalNotes', e.target.value)}
          />
        )}
      </Field>
      <Field label="Anything else?" optional hint={`${500 - draft.notes.length} characters left.`} error={error('notes')}>
        {(p) => (
          <textarea
            id={p.id}
            aria-describedby={p.describedBy}
            rows={3}
            maxLength={500}
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        )}
      </Field>
    </>
  );
}
