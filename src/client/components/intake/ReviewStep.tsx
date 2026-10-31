import type { IntakeCheck } from '../../../shared/intake';
import type { ClientApiError } from '../../lib/api';
import { Notice } from '../Notice';
import { STEP_TITLES, stepsWithErrors, type Errors, type Step } from './draft';

interface ReviewStepProps {
  checks: IntakeCheck[];
  errors: Errors;
  failure: ClientApiError | null;
  sampleData: boolean;
  onFix: (step: Step) => void;
}

function retryHint(failure: ClientApiError): string {
  const seconds = failure.retryAfterSeconds;
  if (!seconds) return '';
  const minutes = Math.ceil(seconds / 60);
  return ` You can try again in about ${minutes} minute${seconds > 60 ? 's' : ''}.`;
}

/** Plausibility checks, anything still missing, and the last error, shown before creating the plan. */
export function ReviewStep({ checks, errors, failure, sampleData, onFix }: ReviewStepProps) {
  const missing = stepsWithErrors(errors);
  return (
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
      {missing.length > 0 && (
        <Notice tone="error" title="A few details are missing">
          <ul>
            {missing.map((s) => (
              <li key={s}>
                <button type="button" className="link" onClick={() => onFix(s)}>
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
          {retryHint(failure)}
        </Notice>
      )}
      <p className="review-note">
        {sampleData
          ? 'This server has no AI key, so the plan will use fixed sample content, clearly labelled.'
          : 'Your answers are sent to Google Gemini to draft the plan. Avoid personal details you would not want shared.'}
      </p>
    </>
  );
}
