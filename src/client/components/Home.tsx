import { useRef, useState } from 'react';
import type { EventType } from '../../shared/constants';
import { EVENT_TYPE_LABELS } from '../../shared/constants';
import { formatShortDate, daysToGoLabel } from '../lib/format';
import { navigate } from '../lib/hooks';
import { deletePlan, listPlans, parsePlanJson, savePlan, storageAvailable, type PlanSummary } from '../lib/storage';
import { Notice } from './Notice';

const CHOICES: { type: EventType; line: string; example: string }[] = [
  {
    type: 'wedding',
    line: 'One function or a full week of them.',
    example: 'Mehendi, sangeet, ceremony and reception for 250 guests',
  },
  {
    type: 'birthday',
    line: 'From a first birthday to a 60th.',
    example: 'A jungle-themed party for 30 children and their parents',
  },
  {
    type: 'community',
    line: 'Festivals, fundraisers and society get-togethers.',
    example: 'A Ganeshotsav programme for 800 neighbours',
  },
];

type Message = { tone: 'success' | 'error'; text: string };

const MAX_IMPORT_BYTES = 1_000_000;

/** Reads an exported plan file, saves it and opens it; returns an error message if it cannot. */
async function importPlanFile(file: File): Promise<string | null> {
  if (file.size > MAX_IMPORT_BYTES) return 'That file is too large to be an Utsav plan.';
  const result = parsePlanJson(await file.text());
  if (!result.ok) return 'That file is not a valid Utsav plan export.';
  if (!savePlan(result.plan).ok) return 'The plan could not be saved in this browser.';
  navigate(`/plan/${result.plan.id}`);
  return null;
}

function EventChoices() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" className="display">
        What are you celebrating?
      </h1>
      <p className="lede">
        Tell Utsav about the event. Google Gemini drafts a budget, a timeline, a vendor checklist and ideas that fit your guests, city and
        style, and the app checks every number.
      </p>
      <ul className="choices" role="list">
        {CHOICES.map((choice) => (
          <li key={choice.type}>
            <a className="choice" href={`#/new/${choice.type}`}>
              <span className="choice-name">{EVENT_TYPE_LABELS[choice.type]}</span>
              <span className="choice-line">{choice.line}</span>
              <span className="choice-example">{choice.example}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImportButton({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="button quiet" onClick={() => fileInput.current?.click()} disabled={disabled}>
        Import a plan file
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Import a plan file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function PlanList({ plans, today, onDelete }: { plans: PlanSummary[]; today: string; onDelete: (plan: PlanSummary) => void }) {
  if (plans.length === 0) return <p className="empty">Plans you create are saved here, in this browser only.</p>;
  return (
    <ul className="plan-list" role="list">
      {plans.map((p) => (
        <li key={p.id} className="plan-row">
          <a href={`#/plan/${p.id}`} className="plan-row-link">
            <span className="plan-row-title">{p.title}</span>
            <span className="plan-row-meta">
              {EVENT_TYPE_LABELS[p.eventType]}, {formatShortDate(p.eventDate, true)} ({daysToGoLabel(p.eventDate, today).toLowerCase()})
            </span>
          </a>
          <button type="button" className="button quiet small" onClick={() => onDelete(p)} aria-label={`Delete ${p.title}`}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Start page: pick an event type, or open, import or delete a saved plan. */
export function Home({ today }: { today: string }) {
  const [plans, setPlans] = useState(listPlans);
  const [message, setMessage] = useState<Message | null>(null);
  const canStore = storageAvailable();

  async function importFile(file: File) {
    const problem = await importPlanFile(file);
    if (problem) setMessage({ tone: 'error', text: problem });
  }

  function remove(plan: PlanSummary) {
    deletePlan(plan.id);
    setPlans(listPlans());
    setMessage({ tone: 'success', text: `Deleted “${plan.title}”.` });
  }

  return (
    <div className="page home">
      <EventChoices />
      <section className="saved" aria-labelledby="saved-title">
        <div className="section-head">
          <h2 id="saved-title">Your plans</h2>
          <ImportButton disabled={!canStore} onFile={(file) => void importFile(file)} />
        </div>
        <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>
        {!canStore && (
          <Notice tone="warn" title="Saving is off in this browser">
            Storage is blocked, for example in some private windows. You can still plan, but export the plan before leaving.
          </Notice>
        )}
        <PlanList plans={plans} today={today} onDelete={remove} />
      </section>
    </div>
  );
}
