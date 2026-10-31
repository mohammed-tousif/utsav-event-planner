import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventType } from '../../../shared/constants';
import { intakeChecks } from '../../../shared/intake';
import type { Plan } from '../../../shared/schemas';
import { ClientApiError, generatePlan } from '../../lib/api';
import { clearDraft, loadDraft, saveDraft } from '../../lib/storage';
import { EMPTY_DRAFT, errorsForStep, restoreDraft, STEPS, stepsWithErrors, validate, type Draft, type Errors, type Step } from './draft';

export type SetField = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function initialDraft(initialType: EventType | null): Draft {
  const merged = restoreDraft(loadDraft());
  // Starting a different kind of event begins from a clean form.
  return initialType && merged.eventType !== initialType ? { ...EMPTY_DRAFT, eventType: initialType } : merged;
}

function focusFirstInvalid(): void {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[data-invalid] input, [data-invalid] select, [data-invalid] textarea')?.focus(),
  );
}

/** Moves focus to the step heading whenever the step changes (not on first render). */
function useFocusOnStepChange(step: Step) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);
  return headingRef;
}

/**
 * State and actions for the five-step intake form: the saved draft,
 * validation, which errors are shown, and creating the plan.
 */
export function useIntakeForm(initialType: EventType | null, today: string, onPlan: (plan: Plan) => void) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(initialType));
  const [step, setStep] = useState<Step>('basics');
  const [shown, setShown] = useState<Errors>({});
  const [pending, setPending] = useState<AbortController | null>(null);
  const [failure, setFailure] = useState<ClientApiError | null>(null);
  const headingRef = useFocusOnStepChange(step);

  useEffect(() => saveDraft(draft), [draft]);

  const result = useMemo(() => validate(draft, today), [draft, today]);
  const checks = useMemo(() => (result.input ? intakeChecks(result.input, today) : []), [result.input, today]);
  const stepIndex = STEPS.indexOf(step);
  const set: SetField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  /** Opens a step showing only that step's errors. */
  function showStep(target: Step) {
    setShown(errorsForStep(target, result.errors));
    setStep(target);
  }

  function next() {
    const stepErrors = errorsForStep(step, result.errors);
    setShown(stepErrors);
    if (Object.keys(stepErrors).length > 0) focusFirstInvalid();
    else setStep(STEPS[stepIndex + 1] ?? 'review');
  }

  function back() {
    setStep(STEPS[stepIndex - 1] ?? 'basics');
  }

  async function create() {
    if (!result.input) {
      showStep(stepsWithErrors(result.errors)[0] ?? 'basics');
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

  return { draft, set, step, stepIndex, setStep, showStep, shown, result, checks, pending, failure, headingRef, next, back, create };
}
