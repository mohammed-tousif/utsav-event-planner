import { useState } from 'react';
import { MAX_GUESTS } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import type { Plan } from '../../shared/schemas';
import type { ClientApiError } from '../lib/api';
import { digitsOnly } from './fields';
import { Notice } from './Notice';
import type { ChangeNotice } from './plan/usePlanEditing';

const SUGGESTIONS: Record<Plan['input']['eventType'], string[]> = {
  wedding: [
    'Reduce the budget by 20%',
    'Increase the guest count to 300',
    'Make this suitable for older guests',
    'Keep the venue budget unchanged but reduce decoration costs',
    'The event is now next week',
  ],
  birthday: [
    'Reduce the budget by 20%',
    'Increase the guest count from 30 to 50',
    'Make it suitable for grandparents too',
    'Keep the venue budget unchanged but reduce decoration costs',
    'The party is now next week',
  ],
  community: [
    'Reduce the budget by 20%',
    'We now expect 300 more people',
    'Make this suitable for older guests',
    'Keep the venue budget unchanged but reduce decoration costs',
    'The event is now next week',
  ],
};

type QuickChange = { totalBudget?: number; guestCount?: number };

interface RevisePanelProps {
  plan: Plan;
  busy: boolean;
  error: ClientApiError | null;
  notice: ChangeNotice | null;
  onRevise: (request: string) => void;
  onCancel: () => void;
  onQuickEdit: (change: QuickChange) => void;
}

function ChangeRequestForm({ plan, busy, onRevise, onCancel }: Pick<RevisePanelProps, 'plan' | 'busy' | 'onRevise' | 'onCancel'>) {
  const [request, setRequest] = useState('');
  const canSend = request.trim().length >= 3 && !busy;
  const send = () => {
    if (canSend) onRevise(request.trim());
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor="revise-request" className="field-label">
        Describe the change
      </label>
      <p id="revise-hint" className="field-hint">
        Gemini decides what should change; the app recalculates every amount and keeps “Kept” categories fixed.
      </p>
      <textarea
        id="revise-request"
        rows={3}
        maxLength={500}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        aria-describedby="revise-hint"
        placeholder="For example: make the menu fully Jain"
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
        }}
      />
      <div className="suggestions" role="group" aria-label="Example changes">
        {SUGGESTIONS[plan.input.eventType].map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setRequest(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <div className="form-actions">
        {busy ? (
          <>
            <span className="working" role="status">
              <span className="dot-pulse" aria-hidden="true" /> Gemini is revising the plan
            </span>
            <button type="button" className="button quiet" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : (
          <button type="submit" className="button primary" disabled={request.trim().length < 3}>
            Apply change
          </button>
        )}
      </div>
    </form>
  );
}

function ReviseFeedback({ busy, notice, error }: Pick<RevisePanelProps, 'busy' | 'notice' | 'error'>) {
  const nothingChanged = error?.code === 'no_change';
  return (
    <div aria-live="polite" className="revise-feedback">
      {notice && !busy && (
        <Notice tone="success" title="Plan updated">
          <p>{notice.summary}</p>
          {notice.changes.length > 0 && (
            <ul className="change-list">
              {notice.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {error && !busy && (
        <Notice tone={nothingChanged ? 'info' : 'error'} title={nothingChanged ? 'Nothing changed' : 'The change was not applied'}>
          {error.message} {!nothingChanged && 'Your plan is unchanged.'}
        </Notice>
      )}
    </div>
  );
}

function quickEditError(guestCount: number, totalBudget: number): string | null {
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_GUESTS) {
    return `Guests must be a whole number from 1 to ${MAX_GUESTS.toLocaleString('en-IN')}.`;
  }
  if (!Number.isFinite(totalBudget) || totalBudget < 1) return 'The total budget must be more than zero.';
  return null;
}

/** Direct edits to guests and budget, recalculated in the browser with no AI call. */
function QuickEdit({ plan, busy, onQuickEdit }: Pick<RevisePanelProps, 'plan' | 'busy' | 'onQuickEdit'>) {
  const [guests, setGuests] = useState(String(plan.input.guestCount));
  const [total, setTotal] = useState(String(plan.input.totalBudget));
  const [quickError, setQuickError] = useState<string | null>(null);

  // Keep the fields in step with the plan after AI revisions.
  const [seenVersion, setSeenVersion] = useState(plan.version);
  if (seenVersion !== plan.version) {
    setSeenVersion(plan.version);
    setGuests(String(plan.input.guestCount));
    setTotal(String(plan.input.totalBudget));
  }

  function submit() {
    const change = { guestCount: Number(guests), totalBudget: Number(total) };
    const problem = quickEditError(change.guestCount, change.totalBudget);
    setQuickError(problem);
    if (!problem) onQuickEdit(change);
  }

  return (
    <details className="quick-edit">
      <summary>Edit guests or budget directly</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="field-row">
          <div className="mini-field">
            <label htmlFor="quick-guests">Guests</label>
            <input id="quick-guests" inputMode="numeric" value={guests} onChange={(e) => setGuests(digitsOnly(e.target.value))} />
          </div>
          <div className="mini-field">
            <label htmlFor="quick-total">Total budget ({plan.input.currency})</label>
            <input
              id="quick-total"
              inputMode="numeric"
              value={total}
              onChange={(e) => setTotal(digitsOnly(e.target.value))}
              aria-describedby="quick-total-hint"
            />
            <span id="quick-total-hint" className="field-hint">
              {Number(total) > 0 ? formatMoney(Number(total), plan.input.currency) : ''}
            </span>
          </div>
        </div>
        {quickError && (
          <p className="field-error" role="alert">
            {quickError}
          </p>
        )}
        <button type="submit" className="button quiet" disabled={busy}>
          Recalculate without AI
        </button>
      </form>
    </details>
  );
}

/** Plain-English changes sent to Gemini, their results, and direct edits. */
export function RevisePanel({ plan, busy, error, notice, onRevise, onCancel, onQuickEdit }: RevisePanelProps) {
  return (
    <section className="revise" aria-labelledby="revise-title">
      <h2 id="revise-title">Change the plan</h2>
      <ChangeRequestForm plan={plan} busy={busy} onRevise={onRevise} onCancel={onCancel} />
      <ReviseFeedback busy={busy} notice={notice} error={error} />
      <QuickEdit plan={plan} busy={busy} onQuickEdit={onQuickEdit} />
    </section>
  );
}
