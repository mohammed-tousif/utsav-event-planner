import type { Plan } from '../../../shared/schemas';
import { downloadFile, fileSlug, planToIcs } from '../../lib/export';

/** Print, plan-file and calendar exports. */
export function ExportPanel({ plan, saved }: { plan: Plan; saved: boolean }) {
  const slug = fileSlug(plan);
  return (
    <section className="export" aria-labelledby="export-title">
      <h2 id="export-title">Save and share</h2>
      <p className="muted">{saved ? 'Saved automatically in this browser.' : 'Not saved in this browser.'}</p>
      <div className="export-actions">
        <button type="button" className="button quiet" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <button
          type="button"
          className="button quiet"
          onClick={() => downloadFile(`${slug}.json`, JSON.stringify(plan, null, 2), 'application/json')}
        >
          Download plan file
        </button>
        <button type="button" className="button quiet" onClick={() => downloadFile(`${slug}.ics`, planToIcs(plan), 'text/calendar')}>
          Add tasks to a calendar
        </button>
      </div>
      <p className="field-hint">The plan file can be imported on the home page, in any browser.</p>
    </section>
  );
}
