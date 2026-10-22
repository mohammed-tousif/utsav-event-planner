import { useState } from 'react';
import { MAX_GUESTS } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import type { Plan } from '../../shared/schemas';
import { ClientApiError } from '../lib/api';
import { Notice } from './Notice';

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

interface RevisePanelProps {
  plan: Plan;
  busy: boolean;
  error: ClientApiError | null;
  notice: { summary: string; changes: string[] } | null;
  onRevise: (request: string) => void;
  onCancel: () => void;
  onQuickEdit: (change: { totalBudget?: number; guestCount?: number }) => void;
}

export function RevisePanel({ plan, busy, error, notice, onRevise, onCancel, onQuickEdit }: RevisePanelProps) {
  const [request, setRequest] = useState('');
  const [guests, setGuests] = useState(String(plan.input.guestCount));
  const [total, setTotal] = useState(String(plan.input.totalBudget));
  const [quickError, setQuickError] = useState<string | null>(null);
  const tooShort = request.trim().length < 3;

  // Keep the quick-edit fields in step with the plan after AI revisions.
  const [seenVersion, setSeenVersion] = useState(plan.version);
  if (seenVersion !== plan.version) {
    setSeenVersion(plan.version);
    setGuests(String(plan.input.guestCount));
    setTotal(String(plan.input.totalBudget));
  }

  function submitQuick() {
    const guestCount = Number(guests);
    const totalBudget = Number(total);
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_GUESTS) {
      setQuickError(`Guests must be a whole number from 1 to ${MAX_GUESTS.toLocaleString('en-IN')}.`);
      return;
    }
    if (!Number.isFinite(totalBudget) || totalBudget < 1) {
      setQuickError('The total budget must be more than zero.');
      return;
    }
    setQuickError(null);
    onQuickEdit({ guestCount, totalBudget });
  }

  return (
    <section className="revise" aria-labelledby="revise-title">
      <h2 id="revise-title">Change the plan</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooShort && !busy) onRevise(request.trim());
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
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !tooShort && !busy) onRevise(request.trim());
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
            <button type="submit" className="button primary" disabled={tooShort}>
              Apply change
            </button>
          )}
        </div>
      </form>
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
          <Notice tone={error.code === 'no_change' ? 'info' : 'error'} title={error.code === 'no_change' ? 'Nothing changed' : 'The change was not applied'}>
            {error.message} {error.code !== 'no_change' && 'Your plan is unchanged.'}
          </Notice>
        )}
      </div>

      <details className="quick-edit">
        <summary>Edit guests or budget directly</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitQuick();
          }}
        >
          <div className="field-row">
            <div className="mini-field">
              <label htmlFor="quick-guests">Guests</label>
              <input id="quick-guests" inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value.replace(/[^\d]/g, ''))} />
            </div>
            <div className="mini-field">
              <label htmlFor="quick-total">Total budget ({plan.input.currency})</label>
              <input id="quick-total" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, ''))} aria-describedby="quick-total-hint" />
              <span id="quick-total-hint" className="field-hint">
                {Number(total) > 0 ? formatMoney(Number(total), plan.input.currency) : ''}
              </span>
            </div>
          </div>
          {quickError && <p className="field-error" role="alert">{quickError}</p>}
          <button type="submit" className="button quiet" disabled={busy}>
            Recalculate without AI
          </button>
        </form>
      </details>
    </section>
  );
}
