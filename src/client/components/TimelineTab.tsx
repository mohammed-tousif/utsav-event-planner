import { PHASE_LABELS, phaseFor, type TaskPhase } from '../../shared/timeline';
import type { Plan, Task } from '../../shared/schemas';
import { dueLabel, formatLongDate, formatTime } from '../lib/format';
import { Notice } from './Notice';

const PHASE_ORDER: TaskPhase[] = ['early', 'months', 'weeks', 'final_week', 'event_day'];
const PRIORITY_TEXT = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' } as const;

interface TimelineTabProps {
  plan: Plan;
  today: string;
  onToggleTask: (id: string, done: boolean) => void;
}

export function TimelineTab({ plan, today, onToggleTask }: TimelineTabProps) {
  const { tasks, schedule, warnings } = plan.timeline;
  const done = tasks.filter((t) => t.done).length;
  const groups = PHASE_ORDER.map((phase) => ({ phase, tasks: tasks.filter((t) => phaseFor(t.offsetDays) === phase) })).filter(
    (g) => g.tasks.length > 0,
  );
  const segments = [...new Set(schedule.map((s) => s.segment))];

  return (
    <div className="timeline-tab">
      {warnings.length > 0 && (
        <div className="stack-s">
          {warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
        </div>
      )}

      <section aria-labelledby="prep-title">
        <div className="section-head">
          <h3 id="prep-title">Preparation</h3>
          <p className="muted" aria-live="polite">
            {done} of {tasks.length} done
          </p>
        </div>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
        </div>
        {groups.map((group) => (
          <div key={group.phase} className="phase">
            <h4 className="phase-title">{PHASE_LABELS[group.phase]}</h4>
            <ul className="task-list" role="list">
              {group.tasks.map((task) => (
                <TaskRow key={task.id} task={task} today={today} onToggle={onToggleTask} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="day-title" className="day-schedule">
        <h3 id="day-title">On the day</h3>
        <p className="muted">{formatLongDate(plan.input.eventDate)}{plan.input.wedding && plan.input.wedding.days > 1 ? `, first of ${plan.input.wedding.days} days` : ''}</p>
        {segments.map((segment) => (
          <div key={segment} className="segment">
            <h4 className="phase-title">{segment}</h4>
            <ol className="schedule" role="list">
              {schedule
                .filter((item) => item.segment === segment)
                .map((item) => (
                  <li key={item.id} className="slot" data-overlap={item.overlaps || undefined}>
                    <span className="slot-time tabular">{formatTime(item.time)}</span>
                    <span className="slot-body">
                      <span className="slot-title">{item.title}</span>
                      <span className="slot-meta">
                        {item.durationMin} min{item.overlaps ? '. Overlaps with the next item, so check timings.' : ''}
                      </span>
                      {item.notes && <span className="slot-notes">{item.notes}</span>}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}

function TaskRow({ task, today, onToggle }: { task: Task; today: string; onToggle: (id: string, done: boolean) => void }) {
  const due = dueLabel(task.dueDate, today);
  return (
    <li className="task" data-done={task.done || undefined}>
      <label className="task-check">
        <input type="checkbox" checked={task.done} onChange={(e) => onToggle(task.id, e.target.checked)} />
        <span className="task-title">{task.title}</span>
      </label>
      <span className="task-meta">
        <span className="due" data-tone={task.done ? undefined : due.tone}>
          {task.done ? 'Done' : due.text}
        </span>
        <span className="priority" data-priority={task.priority}>
          {PRIORITY_TEXT[task.priority]}
        </span>
        {task.compressed && !task.done && <span className="compressed">Brought forward</span>}
      </span>
      {task.notes && <span className="task-notes">{task.notes}</span>}
    </li>
  );
}
