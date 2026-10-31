import type { ComponentType } from 'react';
import type { StatusResponse } from '../../shared/api';
import { EVENT_TYPE_LABELS, type EventType } from '../../shared/constants';
import type { Plan } from '../../shared/schemas';
import { Generating } from './Generating';
import { DetailsStep } from './intake/DetailsStep';
import { STEP_TITLES, STEPS, type Step } from './intake/draft';
import { InvitePreview } from './intake/InvitePreview';
import { ReviewStep } from './intake/ReviewStep';
import { BasicsStep, BudgetStep, PreferencesStep, type StepProps } from './intake/steps';
import { useIntakeForm } from './intake/useIntakeForm';

const STEP_VIEWS: Record<Exclude<Step, 'review'>, ComponentType<StepProps>> = {
  basics: BasicsStep,
  budget: BudgetStep,
  details: DetailsStep,
  preferences: PreferencesStep,
};

interface IntakeProps {
  initialType: EventType | null;
  today: string;
  status: StatusResponse | null;
  onPlan: (plan: Plan) => void;
}

function StepNav({ step, stepIndex, onSelect }: { step: Step; stepIndex: number; onSelect: (step: Step) => void }) {
  return (
    <nav aria-label="Planning steps" className="steps no-print">
      <ol>
        {STEPS.map((s, index) => {
          const done = index < stepIndex;
          const content = (
            <>
              <span className="step-number" aria-hidden="true">
                {index + 1}
              </span>
              {STEP_TITLES[s]}
            </>
          );
          return (
            <li key={s} aria-current={s === step ? 'step' : undefined} data-done={done || undefined}>
              {done ? (
                <button type="button" className="step-link" onClick={() => onSelect(s)}>
                  {content}
                </button>
              ) : (
                <span className="step-link">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The five-step form that collects what Gemini needs to draft a plan. */
export function Intake({ initialType, today, status, onPlan }: IntakeProps) {
  const { draft, set, step, stepIndex, setStep, showStep, shown, result, checks, pending, failure, headingRef, next, back, create } =
    useIntakeForm(initialType, today, onPlan);

  if (pending) {
    const controller = pending;
    return (
      <Generating eventType={draft.eventType || 'wedding'} sample={status?.ai.sampleData ?? false} onCancel={() => controller.abort()} />
    );
  }

  const stepProps: StepProps = { draft, set, error: (key) => shown[key], today };
  const sampleData = status?.ai.sampleData ?? false;
  const StepView = step === 'review' ? null : STEP_VIEWS[step];
  const typeLabel = draft.eventType ? EVENT_TYPE_LABELS[draft.eventType].toLowerCase() : 'event';
  const submitLabel = step !== 'review' ? 'Continue' : failure?.retryable ? 'Try again' : `Create my ${typeLabel} plan`;

  return (
    <div className="page intake">
      <div className="intake-main">
        <StepNav step={step} stepIndex={stepIndex} onSelect={setStep} />
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

          {StepView === null ? (
            <ReviewStep checks={checks} errors={result.errors} failure={failure} sampleData={sampleData} onFix={showStep} />
          ) : (
            <StepView {...stepProps} />
          )}

          <div className="form-actions">
            {stepIndex > 0 && (
              <button type="button" className="button quiet" onClick={back}>
                Back
              </button>
            )}
            <button type="submit" className="button primary">
              {submitLabel}
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
