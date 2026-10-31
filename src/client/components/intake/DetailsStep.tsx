import {
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
  WEDDING_FUNCTIONS,
  WEDDING_FUNCTION_LABELS,
} from '../../../shared/constants';
import { ChoiceGroup, controlProps, digitsOnly, Field } from '../fields';
import { Notice } from '../Notice';
import type { StepProps } from './steps';

/** For a single-choice group: the shared error, shown only while that question is unanswered. */
const unansweredError = (answered: string, error: string | undefined) => (answered ? undefined : error);

function WeddingDetails({ draft, set, error }: StepProps) {
  return (
    <>
      <ChoiceGroup
        legend="Which functions should the plan cover?"
        type="checkbox"
        name="functions"
        options={WEDDING_FUNCTIONS}
        labels={WEDDING_FUNCTION_LABELS}
        value={draft.weddingFunctions}
        onChange={(v) => set('weddingFunctions', v)}
        error={error('wedding.functions') ?? error('wedding')}
      />
      <Field label="Over how many days?" error={error('wedding.days')}>
        {(p) => (
          <input
            {...controlProps(p)}
            className="short"
            inputMode="numeric"
            value={draft.weddingDays}
            onChange={(e) => set('weddingDays', digitsOnly(e.target.value))}
          />
        )}
      </Field>
    </>
  );
}

function BirthdayDetails({ draft, set, error }: StepProps) {
  const shared = error('birthday');
  return (
    <>
      <ChoiceGroup
        legend="Whose birthday is it?"
        type="radio"
        name="ageGroup"
        options={BIRTHDAY_AGE_GROUPS}
        labels={BIRTHDAY_AGE_LABELS}
        value={draft.ageGroup ? [draft.ageGroup] : []}
        onChange={([v]) => set('ageGroup', v ?? '')}
        error={unansweredError(draft.ageGroup, shared)}
      />
      <ChoiceGroup
        legend="Who is coming?"
        type="radio"
        name="audience"
        options={BIRTHDAY_AUDIENCES}
        labels={BIRTHDAY_AUDIENCE_LABELS}
        value={draft.audience ? [draft.audience] : []}
        onChange={([v]) => set('audience', v ?? '')}
        error={unansweredError(draft.audience, shared)}
      />
      <Field label="First name of the birthday person" optional error={error('birthday.honoreeName')}>
        {(p) => (
          <input
            id={p.id}
            aria-describedby={p.describedBy}
            value={draft.honoreeName}
            maxLength={40}
            onChange={(e) => set('honoreeName', e.target.value)}
            autoComplete="off"
          />
        )}
      </Field>
    </>
  );
}

function CommunityDetails({ draft, set, error }: StepProps) {
  const shared = error('community');
  return (
    <>
      <ChoiceGroup
        legend="What kind of community event?"
        type="radio"
        name="format"
        options={COMMUNITY_FORMATS}
        labels={COMMUNITY_FORMAT_LABELS}
        value={draft.format ? [draft.format] : []}
        onChange={([v]) => set('format', v ?? '')}
        error={unansweredError(draft.format, shared)}
      />
      <ChoiceGroup
        legend="Where will it happen?"
        type="radio"
        name="setting"
        options={COMMUNITY_SETTINGS}
        labels={COMMUNITY_SETTING_LABELS}
        value={draft.setting ? [draft.setting] : []}
        onChange={([v]) => set('setting', v ?? '')}
        error={unansweredError(draft.setting, shared)}
      />
      <ChoiceGroup
        legend="How will people get in?"
        type="radio"
        name="entry"
        options={COMMUNITY_ENTRY}
        labels={COMMUNITY_ENTRY_LABELS}
        value={draft.entry ? [draft.entry] : []}
        onChange={([v]) => set('entry', v ?? '')}
        error={unansweredError(draft.entry, shared)}
      />
    </>
  );
}

/** Follow-up questions that depend on the kind of event. */
export function DetailsStep(props: StepProps) {
  switch (props.draft.eventType) {
    case 'wedding':
      return <WeddingDetails {...props} />;
    case 'birthday':
      return <BirthdayDetails {...props} />;
    case 'community':
      return <CommunityDetails {...props} />;
    default:
      return <Notice tone="warn">Choose the kind of event in the first step.</Notice>;
  }
}
