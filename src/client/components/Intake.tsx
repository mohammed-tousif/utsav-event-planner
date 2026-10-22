import { useEffect, useMemo, useRef, useState } from 'react';
import type { StatusResponse } from '../../shared/api';
import {
  ACCESSIBILITY_KEYS,
  ACCESSIBILITY_LABELS,
  BIRTHDAY_AGE_GROUPS,
  BIRTHDAY_AGE_LABELS,
  BIRTHDAY_AUDIENCES,
  BIRTHDAY_AUDIENCE_LABELS,
  COMMUNITY_ENTRY,
  COMMUNITY_ENTRY_LABELS,
  COMMUNITY_FORMATS,
  COMMUNITY_FORMAT_LABELS,
  COMMUNITY_SETTINGS,
  COMMUNITY_SETTING_LABELS,
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
  WEDDING_FUNCTIONS,
  WEDDING_FUNCTION_LABELS,
  type BirthdayAgeGroup,
  type BirthdayAudience,
  type CommunityEntry,
  type CommunityFormat,
  type CommunitySetting,
  type Currency,
  type EventType,
  type VenueStatus,
  type WeddingFunction,
} from '../../shared/constants';
import { addDays, daysBetween, isISODate } from '../../shared/dates';
import { intakeChecks } from '../../shared/intake';
import { formatMoney } from '../../shared/money';
import { EventInputSchema, type EventInput, type Plan } from '../../shared/schemas';
import { ClientApiError, generatePlan } from '../lib/api';
import { daysToGoLabel, formatLongDate } from '../lib/format';
import { navigate } from '../lib/hooks';
import { clearDraft, loadDraft, saveDraft } from '../lib/storage';
import { ChoiceGroup, Field } from './fields';
import { Generating } from './Generating';
import { Notice } from './Notice';

interface Draft {
  eventType: EventType | '';
  title: string;
  eventDate: string;
  guestCount: string;
  totalBudget: string;
  currency: Currency;
  city: string;
  style: string;
  priorities: string[];
  dietary: string[];
  accessibility: string[];
  culturalNotes: string;
  notes: string;
  venueStatus: VenueStatus | '';
  weddingFunctions: WeddingFunction[];
  weddingDays: string;
  ageGroup: BirthdayAgeGroup | '';
  audience: BirthdayAudience | '';
  honoreeName: string;
  format: CommunityFormat | '';
  setting: CommunitySetting | '';
  entry: CommunityEntry | '';
}

const EMPTY: Draft = {
  eventType: '',
  title: '',
  eventDate: '',
  guestCount: '',
  totalBudget: '',
  currency: 'INR',
  city: '',
  style: '',
  priorities: [],
  dietary: [],
  accessibility: [],
  culturalNotes: '',
  notes: '',
  venueStatus: '',
  weddingFunctions: ['ceremony', 'reception'],
  weddingDays: '1',
  ageGroup: '',
  audience: '',
  honoreeName: '',
  format: '',
  setting: '',
  entry: '',
};

const STEPS = ['basics', 'budget', 'details', 'preferences', 'review'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
  basics: 'The basics',
  budget: 'Budget and priorities',
  details: 'A few questions about this event',
  preferences: 'Style and preferences',
  review: 'Check and create',
};

/** Which form fields each step owns, for showing errors on the right step. */
const STEP_FIELDS: Record<Step, string[]> = {
  basics: ['eventType', 'eventDate', 'guestCount', 'city', 'venueStatus', 'title'],
  budget: ['totalBudget', 'currency', 'priorities'],
  details: ['wedding', 'birthday', 'community'],
  preferences: ['style', 'dietary', 'accessibility', 'culturalNotes', 'notes'],
  review: [],
};

const numberFrom = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value.replace(/[,\s_]/g, '')));

function toInput(draft: Draft) {
  const base = {
    eventType: draft.eventType || undefined,
    title: draft.title,
    eventDate: draft.eventDate,
    guestCount: numberFrom(draft.guestCount),
    totalBudget: numberFrom(draft.totalBudget),
    currency: draft.currency,
    city: draft.city,
    style: draft.style,
    priorities: draft.priorities,
    dietary: draft.dietary,
    accessibility: draft.accessibility,
    culturalNotes: draft.culturalNotes,
    notes: draft.notes,
    venueStatus: draft.venueStatus || undefined,
    wedding:
      draft.eventType === 'wedding' ? { functions: draft.weddingFunctions, days: numberFrom(draft.weddingDays) } : undefined,
    birthday:
      draft.eventType === 'birthday' && draft.ageGroup && draft.audience
        ? { ageGroup: draft.ageGroup, audience: draft.audience, honoreeName: draft.honoreeName }
        : undefined,
    community:
      draft.eventType === 'community' && draft.format && draft.setting && draft.entry
        ? { format: draft.format, setting: draft.setting, entry: draft.entry }
        : undefined,
  };
  return base;
}

function friendlyNumberError(field: string, message: string): string {
  if (/expected number, received NaN|Invalid input: expected number/i.test(message)) {
    return field === 'guestCount' ? 'Enter the number of guests.' : field === 'totalBudget' ? 'Enter a total budget as a number.' : 'Enter a number.';
  }
  if (/expected string, received undefined|Invalid option/i.test(message)) return 'Choose one.';
  return message;
}

function validate(draft: Draft, today: string): { input?: EventInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (draft.eventDate && isISODate(draft.eventDate)) {
    const days = daysBetween(today, draft.eventDate);
    if (days < 0) errors.eventDate = 'That date has passed. Choose today or a later date.';
    else if (days > MAX_DAYS_AHEAD) errors.eventDate = 'Choose a date within the next three years.';
  } else if (!draft.eventDate) errors.eventDate = 'Choose the event date.';
  if (draft.eventType === 'birthday' && (!draft.ageGroup || !draft.audience)) errors.birthday = 'Tell us who the birthday is for and who is coming.';
  if (draft.eventType === 'community' && (!draft.format || !draft.setting || !draft.entry)) errors.community = 'Answer all three questions about the event.';

  const parsed = EventInputSchema.safeParse(toInput(draft));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      const top = String(issue.path[0] ?? 'form');
      const field = key.startsWith('wedding') || key.startsWith('birthday') || key.startsWith('community') ? key : top;
      if (!errors[field]) errors[field] = friendlyNumberError(top, issue.message);
    }
  }
  if (draft.priorities.length === 0) errors.priorities = 'Pick at least one thing that matters most.';
  return { input: parsed.success && Object.keys(errors).length === 0 ? parsed.data : undefined, errors };
}

function errorsForStep(step: Step, errors: Record<string, string>): Record<string, string> {
  const owned = STEP_FIELDS[step];
  return Object.fromEntries(Object.entries(errors).filter(([key]) => owned.some((f) => key === f || key.startsWith(`${f}.`))));
}

interface IntakeProps {
  initialType: EventType | null;
  today: string;
  status: StatusResponse | null;
  onPlan: (plan: Plan) => void;
}

export function Intake({ initialType, today, status, onPlan }: IntakeProps) {
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = loadDraft() as Partial<Draft> | null;
    const merged = { ...EMPTY, ...(saved ?? {}) };
    if (initialType && merged.eventType !== initialType) return { ...EMPTY, eventType: initialType };
    return merged;
  });
  const [step, setStep] = useState<Step>('basics');
  const [shown, setShown] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<AbortController | null>(null);
  const [failure, setFailure] = useState<ClientApiError | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => saveDraft(draft as never), [draft]);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const result = useMemo(() => validate(draft, today), [draft, today]);
  const checks = useMemo(() => (result.input ? intakeChecks(result.input, today) : []), [result.input, today]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const stepIndex = STEPS.indexOf(step);

  function next() {
    const stepErrors = errorsForStep(step, result.errors);
    setShown(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-invalid] input, [data-invalid] select, [data-invalid] textarea')?.focus());
      return;
    }
    setStep(STEPS[stepIndex + 1] ?? 'review');
  }

  async function create() {
    if (!result.input) {
      const firstBad = STEPS.find((s) => Object.keys(errorsForStep(s, result.errors)).length > 0) ?? 'basics';
      setShown(errorsForStep(firstBad, result.errors));
      setStep(firstBad);
      return;
    }
    const controller = new AbortController();
    setPending(controller);
    setFailure(null);
    try {
      const response = await generatePlan(result.input, controller.signal);
      clearDraft();
      onPlan(response.plan);
    } catch (error) {
      if (error instanceof ClientApiError && error.code === 'aborted') return;
      const apiError = error instanceof ClientApiError ? error : new ClientApiError('internal', 'Something went wrong. Try again.');
      setFailure(apiError);
      if (apiError.fields && Object.keys(apiError.fields).length) setShown(apiError.fields);
    } finally {
      setPending(null);
    }
  }

  if (pending) {
    return (
      <Generating
        eventType={draft.eventType || 'wedding'}
        sample={status?.ai.sampleData ?? false}
        model={status?.ai.model}
        onCancel={() => pending.abort()}
      />
    );
  }

  const errorProps = (key: string) => shown[key];
  const typeLabel = draft.eventType ? EVENT_TYPE_LABELS[draft.eventType].toLowerCase() : 'event';
  const budgetNumber = numberFrom(draft.totalBudget);
  const guestNumber = numberFrom(draft.guestCount);

  return (
    <div className="page intake">
      <div className="intake-main">
        <nav aria-label="Planning steps" className="steps no-print">
          <ol>
            {STEPS.map((s, index) => (
              <li key={s} aria-current={s === step ? 'step' : undefined} data-done={index < stepIndex || undefined}>
                {index < stepIndex ? (
                  <button type="button" className="step-link" onClick={() => setStep(s)}>
                    <span className="step-number" aria-hidden="true">{index + 1}</span>
                    {STEP_TITLES[s]}
                  </button>
                ) : (
                  <span className="step-link">
                    <span className="step-number" aria-hidden="true">{index + 1}</span>
                    {STEP_TITLES[s]}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <form
          className="intake-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 'review') void create();
            else next();
          }}
        >
          <h1 ref={headingRef} tabIndex={-1} className="step-title">
            {STEP_TITLES[step]}
          </h1>
          <p className="visually-hidden" aria-live="polite">
            Step {stepIndex + 1} of {STEPS.length}
          </p>

          {step === 'basics' && (
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
                error={errorProps('eventType') && 'Choose the kind of event.'}
              />
              <Field label="Event name" optional hint="Shown at the top of your plan, for example “Asha and Rohan’s wedding”." error={errorProps('title')}>
                {(p) => (
                  <input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={draft.title} maxLength={80} onChange={(e) => set('title', e.target.value)} autoComplete="off" />
                )}
              </Field>
              <div className="field-row">
                <Field label="Event date" error={errorProps('eventDate')}>
                  {(p) => (
                    <input
                      id={p.id}
                      type="date"
                      aria-describedby={p.describedBy}
                      aria-invalid={p.invalid || undefined}
                      value={draft.eventDate}
                      min={today}
                      max={addDays(today, MAX_DAYS_AHEAD)}
                      onChange={(e) => set('eventDate', e.target.value)}
                      required
                    />
                  )}
                </Field>
                <Field label="Number of guests" error={errorProps('guestCount')}>
                  {(p) => (
                    <input
                      id={p.id}
                      inputMode="numeric"
                      aria-describedby={p.describedBy}
                      aria-invalid={p.invalid || undefined}
                      value={draft.guestCount}
                      onChange={(e) => set('guestCount', e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="150"
                      required
                    />
                  )}
                </Field>
              </div>
              <Field label="City or area" hint="Used to suggest local customs and realistic costs. No vendor lookups are made." error={errorProps('city')}>
                {(p) => (
                  <input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={draft.city} maxLength={80} onChange={(e) => set('city', e.target.value)} placeholder="Hubballi, Karnataka" autoComplete="address-level2" required />
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
                error={errorProps('venueStatus') && 'Tell us where the venue stands.'}
              />
            </>
          )}

          {step === 'budget' && (
            <>
              <div className="field-row budget-row">
                <Field
                  label="Total budget"
                  hint={Number.isFinite(budgetNumber) && budgetNumber > 0 ? `${formatMoney(budgetNumber, draft.currency)}${Number.isFinite(guestNumber) && guestNumber > 0 ? `, about ${formatMoney(budgetNumber / guestNumber, draft.currency)} per guest` : ''}` : 'Everything included: venue, food, decor and the rest.'}
                  error={errorProps('totalBudget')}
                >
                  {(p) => (
                    <input
                      id={p.id}
                      inputMode="numeric"
                      aria-describedby={p.describedBy}
                      aria-invalid={p.invalid || undefined}
                      value={draft.totalBudget}
                      onChange={(e) => set('totalBudget', e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="800000"
                      required
                    />
                  )}
                </Field>
                <Field label="Currency" error={errorProps('currency')}>
                  {(p) => (
                    <select id={p.id} aria-describedby={p.describedBy} value={draft.currency} onChange={(e) => set('currency', e.target.value as Currency)}>
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
                error={errorProps('priorities')}
              />
            </>
          )}

          {step === 'details' && draft.eventType === 'wedding' && (
            <>
              <ChoiceGroup
                legend="Which functions should the plan cover?"
                type="checkbox"
                name="functions"
                options={WEDDING_FUNCTIONS}
                labels={WEDDING_FUNCTION_LABELS}
                value={draft.weddingFunctions}
                onChange={(v) => set('weddingFunctions', v)}
                error={errorProps('wedding.functions') ?? errorProps('wedding')}
              />
              <Field label="Over how many days?" error={errorProps('wedding.days')}>
                {(p) => (
                  <input id={p.id} className="short" inputMode="numeric" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={draft.weddingDays} onChange={(e) => set('weddingDays', e.target.value.replace(/[^\d]/g, ''))} />
                )}
              </Field>
            </>
          )}
          {step === 'details' && draft.eventType === 'birthday' && (
            <>
              <ChoiceGroup legend="Whose birthday is it?" type="radio" name="ageGroup" options={BIRTHDAY_AGE_GROUPS} labels={BIRTHDAY_AGE_LABELS} value={draft.ageGroup ? [draft.ageGroup] : []} onChange={([v]) => set('ageGroup', v ?? '')} error={!draft.ageGroup ? errorProps('birthday') : undefined} />
              <ChoiceGroup legend="Who is coming?" type="radio" name="audience" options={BIRTHDAY_AUDIENCES} labels={BIRTHDAY_AUDIENCE_LABELS} value={draft.audience ? [draft.audience] : []} onChange={([v]) => set('audience', v ?? '')} error={!draft.audience ? errorProps('birthday') : undefined} />
              <Field label="First name of the birthday person" optional error={errorProps('birthday.honoreeName')}>
                {(p) => <input id={p.id} aria-describedby={p.describedBy} value={draft.honoreeName} maxLength={40} onChange={(e) => set('honoreeName', e.target.value)} autoComplete="off" />}
              </Field>
            </>
          )}
          {step === 'details' && draft.eventType === 'community' && (
            <>
              <ChoiceGroup legend="What kind of community event?" type="radio" name="format" options={COMMUNITY_FORMATS} labels={COMMUNITY_FORMAT_LABELS} value={draft.format ? [draft.format] : []} onChange={([v]) => set('format', v ?? '')} error={!draft.format ? errorProps('community') : undefined} />
              <ChoiceGroup legend="Where will it happen?" type="radio" name="setting" options={COMMUNITY_SETTINGS} labels={COMMUNITY_SETTING_LABELS} value={draft.setting ? [draft.setting] : []} onChange={([v]) => set('setting', v ?? '')} error={!draft.setting ? errorProps('community') : undefined} />
              <ChoiceGroup legend="How will people get in?" type="radio" name="entry" options={COMMUNITY_ENTRY} labels={COMMUNITY_ENTRY_LABELS} value={draft.entry ? [draft.entry] : []} onChange={([v]) => set('entry', v ?? '')} error={!draft.entry ? errorProps('community') : undefined} />
            </>
          )}
          {step === 'details' && !draft.eventType && <Notice tone="warn">Choose the kind of event in the first step.</Notice>}

          {step === 'preferences' && (
            <>
              <Field label="Style or theme" hint="A few words is enough, for example “South Indian temple style in gold and maroon”." error={errorProps('style')}>
                {(p) => <input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={draft.style} maxLength={120} onChange={(e) => set('style', e.target.value)} required />}
              </Field>
              <ChoiceGroup legend="Food needs" optional type="checkbox" name="dietary" options={DIETARY_KEYS} labels={DIETARY_LABELS} value={draft.dietary as never} onChange={(v) => set('dietary', v)} />
              <ChoiceGroup legend="Accessibility and comfort" optional type="checkbox" name="accessibility" options={ACCESSIBILITY_KEYS} labels={ACCESSIBILITY_LABELS} value={draft.accessibility as never} onChange={(v) => set('accessibility', v)} />
              <Field label="Cultural or religious customs" optional hint="Rituals, timings or traditions the plan should respect." error={errorProps('culturalNotes')}>
                {(p) => <textarea id={p.id} aria-describedby={p.describedBy} rows={3} maxLength={300} value={draft.culturalNotes} onChange={(e) => set('culturalNotes', e.target.value)} />}
              </Field>
              <Field label="Anything else?" optional hint={`${500 - draft.notes.length} characters left.`} error={errorProps('notes')}>
                {(p) => <textarea id={p.id} aria-describedby={p.describedBy} rows={3} maxLength={500} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />}
              </Field>
            </>
          )}

          {step === 'review' && (
            <>
              {checks.length > 0 && (
                <div className="checks">
                  {checks.map((check) => (
                    <Notice key={check.code} tone={check.level === 'warn' ? 'warn' : 'info'}>
                      {check.message}
                    </Notice>
                  ))}
                </div>
              )}
              {Object.keys(result.errors).length > 0 && (
                <Notice tone="error" title="A few details are missing">
                  <ul>
                    {STEPS.filter((s) => Object.keys(errorsForStep(s, result.errors)).length > 0).map((s) => (
                      <li key={s}>
                        <button type="button" className="link" onClick={() => { setShown(errorsForStep(s, result.errors)); setStep(s); }}>
                          {STEP_TITLES[s]}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
              {failure && (
                <Notice tone="error" title="The plan was not created" live>
                  {failure.message}
                  {failure.retryAfterSeconds ? ` You can try again in about ${Math.ceil(failure.retryAfterSeconds / 60)} minute${failure.retryAfterSeconds > 60 ? 's' : ''}.` : ''}
                </Notice>
              )}
              <p className="review-note">
                {status?.ai.sampleData
                  ? 'This server has no AI key, so the plan will use fixed sample content, clearly labelled.'
                  : `Your answers are sent to Google Gemini${status?.ai.model ? ` (${status.ai.model})` : ''} to draft the plan. Avoid personal details you would not want shared.`}
              </p>
            </>
          )}

          <div className="form-actions">
            {stepIndex > 0 && (
              <button type="button" className="button quiet" onClick={() => setStep(STEPS[stepIndex - 1] ?? 'basics')}>
                Back
              </button>
            )}
            <button type="submit" className="button primary">
              {step === 'review' ? (failure?.retryable ? 'Try again' : `Create my ${typeLabel} plan`) : 'Continue'}
            </button>
          </div>
        </form>
      </div>

      <aside className="invite no-print" aria-label="Your event so far">
        <InvitePreview draft={draft} today={today} />
      </aside>
    </div>
  );
}

function InvitePreview({ draft, today }: { draft: Draft; today: string }) {
  const budget = numberFrom(draft.totalBudget);
  const guests = numberFrom(draft.guestCount);
  const validDate = draft.eventDate && isISODate(draft.eventDate) && daysBetween(today, draft.eventDate) >= 0;
  const title = draft.title || (draft.eventType ? `Your ${EVENT_TYPE_LABELS[draft.eventType].toLowerCase()}` : 'Your celebration');
  return (
    <div className="invite-card">
      <p className="invite-kind">{draft.eventType ? EVENT_TYPE_LABELS[draft.eventType] : 'Event'}</p>
      <p className="invite-title">{title}</p>
      <dl className="invite-facts">
        <div>
          <dt>When</dt>
          <dd>{validDate ? `${formatLongDate(draft.eventDate)}, ${daysToGoLabel(draft.eventDate, today).toLowerCase()}` : 'Date to be chosen'}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{draft.city || 'City to be chosen'}</dd>
        </div>
        <div>
          <dt>Guests</dt>
          <dd>{Number.isFinite(guests) && guests > 0 ? guests.toLocaleString('en-IN') : 'Not set'}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{Number.isFinite(budget) && budget > 0 ? formatMoney(budget, draft.currency) : 'Not set'}</dd>
        </div>
        {draft.style && (
          <div>
            <dt>Style</dt>
            <dd>{draft.style}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
