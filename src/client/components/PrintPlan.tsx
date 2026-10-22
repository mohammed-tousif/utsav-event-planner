import { CATEGORY_META, EVENT_TYPE_LABELS } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import type { Plan } from '../../shared/schemas';
import { formatLongDate, formatShortDate, formatTime, pct } from '../lib/format';
import { planTitle } from '../lib/storage';

/** A complete, linear version of the plan used only when printing or saving as PDF. */
export function PrintPlan({ plan }: { plan: Plan }) {
  const { input, budget } = plan;
  return (
    <article className="print-plan" aria-hidden="true">
      <h1>{planTitle(plan)}</h1>
      <p>
        {EVENT_TYPE_LABELS[input.eventType]} in {input.city} on {formatLongDate(input.eventDate)} for {input.guestCount} guests. Total budget{' '}
        {formatMoney(budget.total, budget.currency)}. Style: {input.style}.
      </p>
      <p className="print-source">
        {plan.meta.source === 'ai' ? `Drafted with ${plan.meta.provider} (${plan.meta.model}).` : 'Sample data, not AI-generated.'} Costs are
        estimates, not quotes. Printed from Utsav, version {plan.version}.
      </p>
      {plan.summary && <p>{plan.summary}</p>}

      <h2>Budget</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {budget.lines.map((l) => (
            <tr key={l.key}>
              <td>
                {l.label}
                {l.locked ? ' (kept fixed)' : ''}
              </td>
              <td>{formatMoney(l.amount, budget.currency)}</td>
              <td>{pct(l.amount, budget.total)}</td>
            </tr>
          ))}
          <tr>
            <td>Contingency</td>
            <td>{formatMoney(budget.contingency, budget.currency)}</td>
            <td>{pct(budget.contingency, budget.total)}</td>
          </tr>
          <tr>
            <th>Total</th>
            <th>{formatMoney(budget.total, budget.currency)}</th>
            <th>100%</th>
          </tr>
        </tbody>
      </table>
      {budget.tradeoffs.length > 0 && (
        <>
          <h3>Trade-offs</h3>
          <ul>
            {budget.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}

      <h2>Timeline</h2>
      <table>
        <thead>
          <tr>
            <th>Done</th>
            <th>Task</th>
            <th>Due</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {plan.timeline.tasks.map((t) => (
            <tr key={t.id}>
              <td>{t.done ? 'Yes' : ''}</td>
              <td>{t.title}</td>
              <td>{formatShortDate(t.dueDate, true)}</td>
              <td>{t.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>On the day</h3>
      <table>
        <tbody>
          {plan.timeline.schedule.map((s) => (
            <tr key={s.id}>
              <td>{s.segment}</td>
              <td>{formatTime(s.time)}</td>
              <td>
                {s.title} ({s.durationMin} min)
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Vendors</h2>
      {plan.vendors.map((v) => (
        <section key={v.id} className="print-vendor">
          <h3>
            {v.label}: {v.status.replace('_', ' ')}
            {v.quote !== null ? `, quote ${formatMoney(v.quote, budget.currency)}` : ''}
          </h3>
          <p>{v.why}</p>
          <p>Ask: {v.questions.join(' ')}</p>
        </section>
      ))}

      <h2>Ideas</h2>
      {plan.ideas.map((i) => (
        <section key={i.id}>
          <h3>{i.title}</h3>
          <p>
            {i.description} Why it fits: {i.whyItFits} About {formatMoney(i.estimatedCost, budget.currency)} from{' '}
            {CATEGORY_META[i.budgetCategory].label.toLowerCase()}.
          </p>
        </section>
      ))}

      {plan.assumptions.length > 0 && (
        <>
          <h2>Assumptions</h2>
          <ul>
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
