import { formatMoney } from '../../shared/money';
import type { Plan } from '../../shared/schemas';
import { AiExchangePanel } from './AiExchangePanel';

const SECTION = { tasks: 'tasks', schedule: 'event-day schedule', vendors: 'vendor guidance', ideas: 'ideas' } as const;
const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function HistoryTab({ plan, exchangeOpen }: { plan: Plan; exchangeOpen: boolean }) {
  const exchange = plan.meta.exchange ? (
    <AiExchangePanel exchange={plan.meta.exchange} sample={plan.meta.source === 'sample'} open={exchangeOpen} />
  ) : null;
  if (plan.revisions.length === 0) {
    return (
      <>
        {exchange}
        <p className="empty">No changes yet. Changes you make appear here with what moved and why.</p>
      </>
    );
  }
  const currency = plan.input.currency;
  return (
    <>
    {exchange}
    <ol className="history" role="list">
      {plan.revisions.map((entry) => {
        const moved = entry.diff.lines.filter((l) => l.before !== l.after);
        return (
          <li key={entry.id} className="history-entry">
            <p className="history-when">
              {when.format(new Date(entry.at))}, {entry.kind === 'ai' ? 'changed with Gemini' : 'edited in the app'}
            </p>
            <p className="history-request">{entry.kind === 'ai' ? `“${entry.request}”` : entry.request}</p>
            {entry.understood && <p className="muted">{entry.understood}</p>}
            {entry.changes.length > 0 && (
              <ul>
                {entry.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {entry.tradeoffs.length > 0 && (
              <p className="history-tradeoffs">
                <strong>Trade-offs:</strong> {entry.tradeoffs.join(' ')}
              </p>
            )}
            <p className="history-diff">
              Total {formatMoney(entry.diff.totalBefore, currency)} to {formatMoney(entry.diff.totalAfter, currency)}
              {entry.diff.guestsBefore !== entry.diff.guestsAfter ? `, guests ${entry.diff.guestsBefore} to ${entry.diff.guestsAfter}` : ''}
              {entry.diff.dateBefore !== entry.diff.dateAfter ? `, date ${entry.diff.dateBefore} to ${entry.diff.dateAfter}` : ''}.{' '}
              {moved.length} categor{moved.length === 1 ? 'y' : 'ies'} moved
              {entry.diff.regenerated.length ? `; rewrote ${entry.diff.regenerated.map((r) => SECTION[r]).join(', ')}` : ''}.
            </p>
          </li>
        );
      })}
    </ol>
    </>
  );
}
