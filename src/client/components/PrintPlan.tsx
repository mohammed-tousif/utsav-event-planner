import { CATEGORY_META, EVENT_TYPE_LABELS } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import type { Plan } from '../../shared/schemas';
import { formatLongDate, formatShortDate, formatTime, pct } from '../lib/format';
import { planTitle } from '../lib/storage';

function PrintList({ title, items, level = 'h3' }: { title: string; items: string[]; level?: 'h2' | 'h3' }) {
  if (items.length === 0) return null;
  const Heading = level;
  return (
    <>
      <Heading>{title}</Heading>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function PrintBudget({ plan }: { plan: Plan }) {
  const { budget } = plan;
  const money = (amount: number) => formatMoney(amount, budget.currency);
  return (
    <>
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
              <td>{money(l.amount)}</td>
              <td>{pct(l.amount, budget.total)}</td>
            </tr>
          ))}
          <tr>
            <td>Contingency</td>
            <td>{money(budget.contingency)}</td>
            <td>{pct(budget.contingency, budget.total)}</td>
          </tr>
          <tr>
            <th>Total</th>
            <th>{money(budget.total)}</th>
            <th>100%</th>
          </tr>
        </tbody>
      </table>
      <PrintList title="Trade-offs" items={budget.tradeoffs} />
    </>
  );
}

function PrintTimeline({ plan }: { plan: Plan }) {
  return (
    <>
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
    </>
  );
}

function PrintVendorsAndIdeas({ plan }: { plan: Plan }) {
  const money = (amount: number) => formatMoney(amount, plan.budget.currency);
  return (
    <>
      <h2>Vendors</h2>
      {plan.vendors.map((v) => (
        <section key={v.id} className="print-vendor">
          <h3>
            {v.label}: {v.status.replace('_', ' ')}
            {v.quote !== null ? `, quote ${money(v.quote)}` : ''}
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
            {i.description} Why it fits: {i.whyItFits} About {money(i.estimatedCost)} from{' '}
            {CATEGORY_META[i.budgetCategory].label.toLowerCase()}.
          </p>
        </section>
      ))}
    </>
  );
}

/** A complete, linear version of the plan used only when printing or saving as PDF. */
export function PrintPlan({ plan }: { plan: Plan }) {
  const { input, budget } = plan;
  return (
    <article className="print-plan" aria-hidden="true">
      <h1>{planTitle(plan)}</h1>
      <p>
        {EVENT_TYPE_LABELS[input.eventType]} in {input.city} on {formatLongDate(input.eventDate)} for {input.guestCount} guests. Total
        budget {formatMoney(budget.total, budget.currency)}. Style: {input.style}.
      </p>
      <p className="print-source">
        {plan.meta.source === 'ai' ? `Drafted with ${plan.meta.provider} (${plan.meta.model}).` : 'Sample data, not AI-generated.'} Costs
        are estimates, not quotes. Printed from Utsav, version {plan.version}.
      </p>
      {plan.summary && <p>{plan.summary}</p>}
      <PrintBudget plan={plan} />
      <PrintTimeline plan={plan} />
      <PrintVendorsAndIdeas plan={plan} />
      <PrintList title="Assumptions" items={plan.assumptions} level="h2" />
    </article>
  );
}
