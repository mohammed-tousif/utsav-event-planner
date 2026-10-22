import { useState } from 'react';
import { formatMoney } from '../../shared/money';
import { VENDOR_STATUSES, type Plan, type Vendor, type VendorStatus } from '../../shared/schemas';
import { dueLabel } from '../lib/format';

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

export function VendorsTab({ plan, today, onUpdate }: VendorsTabProps) {
  const booked = plan.vendors.filter((v) => v.status === 'booked').length;
  return (
    <div className="vendors-tab">
      <p className="tab-intro">
        A checklist of the vendors this {plan.input.eventType === 'community' ? 'event' : plan.input.eventType} needs, with questions
        to ask. Utsav does not list, rate or verify real businesses: find vendors yourself and record quotes here.
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

function VendorRow({ vendor, plan, today, onUpdate }: { vendor: Vendor; plan: Plan; today: string; onUpdate: VendorsTabProps['onUpdate'] }) {
  const [quote, setQuote] = useState(vendor.quote === null ? '' : String(vendor.quote));
  const [notes, setNotes] = useState(vendor.notes);
  const line = plan.budget.lines.find((l) => l.key === vendor.budgetCategory);
  const due = dueLabel(vendor.bookByDate, today);
  const quoteNumber = vendor.quote;
  const over = quoteNumber !== null && line ? quoteNumber - line.amount : 0;
  const id = `vendor-${vendor.id}`;

  return (
    <li className="vendor" data-status={vendor.status}>
      <div className="vendor-head">
        <h3 className="vendor-name">{vendor.label}</h3>
        <span className="source" data-source={vendor.source}>
          {vendor.source === 'ai' ? 'Gemini guidance' : 'Standard checklist'}
        </span>
      </div>
      <p className="vendor-why">{vendor.why}</p>
      <div className="vendor-controls">
        <div className="mini-field">
          <label htmlFor={`${id}-status`}>Status</label>
          <select id={`${id}-status`} value={vendor.status} onChange={(e) => onUpdate(vendor.id, { status: e.target.value as VendorStatus })}>
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
            onChange={(e) => setQuote(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              const value = quote === '' ? null : Number(quote);
              if (value !== vendor.quote) onUpdate(vendor.id, { quote: value });
            }}
            aria-describedby={`${id}-quote-note`}
          />
        </div>
        <p id={`${id}-quote-note`} className="vendor-budget">
          {line ? `Budget for ${line.label.toLowerCase()}: ${formatMoney(line.amount, plan.input.currency)}.` : ''}{' '}
          {quoteNumber !== null && line && (over > 0 ? `This quote is ${formatMoney(over, plan.input.currency)} over.` : 'This quote fits.')}
        </p>
        <p className="vendor-due">
          <span className="due" data-tone={vendor.status === 'booked' ? undefined : due.tone}>
            {vendor.status === 'booked' ? 'Booked' : `Book by ${due.text.replace(/^Due /, '').toLowerCase()}`}
          </span>
        </p>
      </div>
      <details className="vendor-details">
        <summary>Questions to ask and what to compare</summary>
        <div className="vendor-detail-grid">
          <div>
            <h4>Ask</h4>
            <ul>
              {vendor.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Compare on</h4>
            <ul>
              {vendor.compareOn.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            {vendor.redFlags.length > 0 && (
              <>
                <h4>Watch out for</h4>
                <ul>
                  {vendor.redFlags.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
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
    </li>
  );
}
