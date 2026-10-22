import { CATEGORY_META } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import type { Plan } from '../../shared/schemas';

const EFFORT = { low: 'Easy to arrange', medium: 'Some planning', high: 'Needs a lot of planning' } as const;

export function IdeasTab({ plan, changed }: { plan: Plan; changed: boolean }) {
  if (plan.ideas.length === 0) {
    return <p className="empty">No ideas yet. Ask for some in the change box, for example “Suggest ideas for older guests”.</p>;
  }
  return (
    <div className="ideas-tab">
      {changed && <p className="muted">These ideas were rewritten in the last change.</p>}
      <ol className="idea-list" role="list">
        {plan.ideas.map((idea) => (
          <li key={idea.id} className="idea">
            <h3 className="idea-title">{idea.title}</h3>
            <p>{idea.description}</p>
            <p className="idea-why">
              <span className="idea-why-label">Why it fits: </span>
              {idea.whyItFits}
            </p>
            <p className="idea-meta">
              <span>
                About {formatMoney(idea.estimatedCost, plan.input.currency)} from {CATEGORY_META[idea.budgetCategory].label.toLowerCase()}
              </span>
              <span data-fits={idea.fitsBudget}>{idea.fitsBudget ? 'Fits that budget line' : 'More than that budget line'}</span>
              <span>{EFFORT[idea.effort]}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
