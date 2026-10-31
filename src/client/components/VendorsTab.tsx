import { useState } from 'react';
import { formatMoney } from '../../shared/money';
import { VENDOR_STATUSES, type Plan, type Vendor, type VendorStatus } from '../../shared/schemas';
import { isOneOf } from '../../shared/guards';
import { bookByLabel } from '../lib/format';
import { digitsOnly } from './fields';

const STATUS_LABELS: Record<VendorStatus, string> = {
  not_started: 'Not started',
  researching: 'Researching',
  contacted: 'Contacted',
  quote_received: 'Quote received',
  booked: 'Booked',
};

interface VendorsTabProps {
  plan: Plan;
  today: string;
  onUpdate: (id: string, patch: Partial<Pick<Vendor, 'status' | 'quote' | 'notes'>>) => void;
}

/** The vendor checklist with status, quotes checked against the budget, and questions to ask. */
export function VendorsTab({ plan, today, onUpdate }: VendorsTabProps) {
  const booked = plan.vendors.filter((v) => v.status === 'booked').length;
  return (
    <div className="vendors-tab">
      <p className="tab-intro">
        A checklist of the vendors this {plan.input.eventType === 'community' ? 'event' : plan.input.eventType} needs, with questions to
        ask. Utsav does not list, rate or verify real businesses: find vendors yourself and record quotes here.
      </p>
      <p className="muted" aria-live="polite">
        {booked} of {plan.vendors.length} booked
      </p>
      <ul className="vendor-list" role="list">
        {plan.vendors.map((vendor) => (
          <VendorRow key={vendor.id} vendor={vendor} plan={plan} today={today} onUpdate={onUpdate} />
        ))}
      </ul>
    </div>
  );
}

type Update = VendorsTabProps['onUpdate'];

/** "Budget for food and drinks: ₹5,67,500. This quote is ₹32,500 over." */
function quoteNote(vendor: Vendor, plan: Plan): string {
  const line = plan.budget.lines.find((l) => l.key === vendor.budgetCategory);
  if (!line) return '';
  const currency = plan.input.currency;
  const budget = `Budget for ${line.label.toLowerCase()}: ${formatMoney(line.amount, currency)}.`;
  if (vendor.quote === null) return budget;
  const over = vendor.quote - line.amount;
  return `${budget} ${over > 0 ? `This quote is ${formatMoney(over, currency)} over.` : 'This quote fits.'}`;
}

function VendorControls({ vendor, plan, today, onUpdate }: { vendor: Vendor; plan: Plan; today: string; onUpdate: Update }) {
  const [quote, setQuote] = useState(vendor.quote === null ? '' : String(vendor.quote));
  const due = bookByLabel(vendor.bookByDate, today);
  const booked = vendor.status === 'booked';
  const id = `vendor-${vendor.id}`;
  return (
    <div className="vendor-controls">
      <div className="mini-field">
        <label htmlFor={`${id}-status`}>Status</label>
        <select
          id={`${id}-status`}
          value={vendor.status}
          onChange={(e) => {
            if (isOneOf(VENDOR_STATUSES, e.target.value)) onUpdate(vendor.id, { status: e.target.value });
          }}
        >
          {VENDOR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="mini-field">
        <label htmlFor={`${id}-quote`}>Quote you received ({plan.input.currency})</label>
        <input
          id={`${id}-quote`}
          inputMode="numeric"
          value={quote}
          placeholder="Not yet"
          onChange={(e) => setQuote(digitsOnly(e.target.value))}
          onBlur={() => {
            const value = quote === '' ? null : Number(quote);
            if (value !== vendor.quote) onUpdate(vendor.id, { quote: value });
          }}
          aria-describedby={`${id}-quote-note`}
        />
      </div>
      <p id={`${id}-quote-note`} className="vendor-budget">
        {quoteNote(vendor, plan)}
      </p>
      <p className="vendor-due">
        <span className="due" data-tone={booked ? undefined : due.tone}>
          {booked ? 'Booked' : due.text}
        </span>
      </p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function VendorDetails({ vendor, onUpdate }: { vendor: Vendor; onUpdate: Update }) {
  const [notes, setNotes] = useState(vendor.notes);
  const id = `vendor-${vendor.id}`;
  return (
    <details className="vendor-details">
      <summary>Questions to ask and what to compare</summary>
      <div className="vendor-detail-grid">
        <div>
          <List title="Ask" items={vendor.questions} />
        </div>
        <div>
          <List title="Compare on" items={vendor.compareOn} />
          <List title="Watch out for" items={vendor.redFlags} />
        </div>
      </div>
      <div className="mini-field wide">
        <label htmlFor={`${id}-notes`}>Your notes</label>
        <textarea
          id={`${id}-notes`}
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== vendor.notes && onUpdate(vendor.id, { notes })}
        />
      </div>
    </details>
  );
}

function VendorRow({ vendor, plan, today, onUpdate }: { vendor: Vendor; plan: Plan; today: string; onUpdate: Update }) {
  // Gemini's guidance is only labelled as such on plans Gemini actually drafted.
  const tailored = vendor.source === 'ai' && plan.meta.source === 'ai';
  return (
    <li className="vendor" data-status={vendor.status}>
      <div className="vendor-head">
        <h3 className="vendor-name">{vendor.label}</h3>
        <span className="source" data-source={vendor.source}>
          {tailored ? 'Tailored by Gemini' : 'Standard checklist'}
        </span>
      </div>
      <p className="vendor-why">{vendor.why}</p>
      <VendorControls vendor={vendor} plan={plan} today={today} onUpdate={onUpdate} />
      <VendorDetails vendor={vendor} onUpdate={onUpdate} />
    </li>
  );
}
