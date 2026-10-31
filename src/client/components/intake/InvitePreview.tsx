import { EVENT_TYPE_LABELS } from '../../../shared/constants';
import { daysBetween, isISODate } from '../../../shared/dates';
import { formatMoney } from '../../../shared/money';
import { daysToGoLabel, formatLongDate } from '../../lib/format';
import { positiveNumber, type Draft } from './draft';

function whenText(eventDate: string, today: string): string {
  const valid = eventDate && isISODate(eventDate) && daysBetween(today, eventDate) >= 0;
  return valid ? `${formatLongDate(eventDate)}, ${daysToGoLabel(eventDate, today).toLowerCase()}` : 'Date to be chosen';
}

function titleText(draft: Draft): string {
  if (draft.title) return draft.title;
  return draft.eventType ? `Your ${EVENT_TYPE_LABELS[draft.eventType].toLowerCase()}` : 'Your celebration';
}

/** A live "invitation" summarising the answers so far. */
export function InvitePreview({ draft, today }: { draft: Draft; today: string }) {
  const budget = positiveNumber(draft.totalBudget);
  const guests = positiveNumber(draft.guestCount);
  const facts: [string, string][] = [
    ['When', whenText(draft.eventDate, today)],
    ['Where', draft.city || 'City to be chosen'],
    ['Guests', guests ? guests.toLocaleString('en-IN') : 'Not set'],
    ['Budget', budget ? formatMoney(budget, draft.currency) : 'Not set'],
  ];
  if (draft.style) facts.push(['Style', draft.style]);
  return (
    <div className="invite-card">
      <p className="invite-kind">{draft.eventType ? EVENT_TYPE_LABELS[draft.eventType] : 'Event'}</p>
      <p className="invite-title">{titleText(draft)}</p>
      <dl className="invite-facts">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
