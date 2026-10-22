import { useRef, useState } from 'react';
import type { EventType } from '../../shared/constants';
import { EVENT_TYPE_LABELS } from '../../shared/constants';
import { formatShortDate, daysToGoLabel } from '../lib/format';
import { navigate } from '../lib/hooks';
import { deletePlan, listPlans, parsePlanJson, savePlan, storageAvailable } from '../lib/storage';
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

export function Home({ today }: { today: string }) {
  const [plans, setPlans] = useState(listPlans);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canStore = storageAvailable();

  async function importFile(file: File) {
    if (file.size > 1_000_000) {
      setMessage({ tone: 'error', text: 'That file is too large to be an Utsav plan.' });
      return;
    }
    const result = parsePlanJson(await file.text());
    if (!result.ok) {
      setMessage({ tone: 'error', text: 'That file is not a valid Utsav plan export.' });
      return;
    }
    const saved = savePlan(result.plan);
    if (!saved.ok) {
      setMessage({ tone: 'error', text: 'The plan could not be saved in this browser.' });
      return;
    }
    navigate(`/plan/${result.plan.id}`);
  }

  function remove(id: string, title: string) {
    deletePlan(id);
    setPlans(listPlans());
    setMessage({ tone: 'success', text: `Deleted “${title}”.` });
  }

  return (
    <div className="page home">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" className="display">
          What are you celebrating?
        </h1>
        <p className="lede">
          Tell Utsav about the event. Google Gemini drafts a budget, a timeline, a vendor checklist and ideas that fit your
          guests, city and style, and the app checks every number.
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

      <section className="saved" aria-labelledby="saved-title">
        <div className="section-head">
          <h2 id="saved-title">Your plans</h2>
          <button type="button" className="button quiet" onClick={() => fileInput.current?.click()} disabled={!canStore}>
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
              if (file) void importFile(file);
            }}
          />
        </div>
        <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>
        {!canStore && (
          <Notice tone="warn" title="Saving is off in this browser">
            Storage is blocked, for example in some private windows. You can still plan, but export the plan before leaving.
          </Notice>
        )}
        {plans.length === 0 ? (
          <p className="empty">Plans you create are saved here, in this browser only.</p>
        ) : (
          <ul className="plan-list" role="list">
            {plans.map((p) => (
              <li key={p.id} className="plan-row">
                <a href={`#/plan/${p.id}`} className="plan-row-link">
                  <span className="plan-row-title">{p.title}</span>
                  <span className="plan-row-meta">
                    {EVENT_TYPE_LABELS[p.eventType]}, {formatShortDate(p.eventDate, true)} ({daysToGoLabel(p.eventDate, today).toLowerCase()})
                  </span>
                </a>
                <button type="button" className="button quiet small" onClick={() => remove(p.id, p.title)} aria-label={`Delete ${p.title}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
