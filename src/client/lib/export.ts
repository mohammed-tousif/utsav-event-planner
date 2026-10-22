import type { Plan } from '../../shared/schemas';
import { addDays } from '../../shared/dates';
import { planTitle } from './storage';

/** Escapes text for an iCalendar property value (RFC 5545 §3.3.11). */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds long lines to 75 octets as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const charSize = new TextEncoder().encode(char).length;
    if (size + charSize > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compact = (date: string) => date.replace(/-/g, '');

/** All-day calendar entries for the event and every open task. */
export function planToIcs(plan: Plan, stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const title = planTitle(plan);
  const events: string[][] = [
    [
      'BEGIN:VEVENT',
      `UID:${plan.id}-event@utsav`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(plan.input.eventDate)}`,
      `DTEND;VALUE=DATE:${compact(addDays(plan.input.eventDate, Math.max(1, plan.input.wedding?.days ?? 1)))}`,
      `SUMMARY:${icsEscape(title)}`,
      `LOCATION:${icsEscape(plan.input.city)}`,
      'END:VEVENT',
    ],
    ...plan.timeline.tasks
      .filter((task) => !task.done)
      .map((task) => [
        'BEGIN:VEVENT',
        `UID:${plan.id}-${task.id}@utsav`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${compact(task.dueDate)}`,
        `DTEND;VALUE=DATE:${compact(addDays(task.dueDate, 1))}`,
        `SUMMARY:${icsEscape(`${title}: ${task.title}`)}`,
        ...(task.notes ? [`DESCRIPTION:${icsEscape(task.notes)}`] : []),
        'END:VEVENT',
      ]),
  ];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Utsav//Event planner//EN', 'CALSCALE:GREGORIAN', ...events.flat(), 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function fileSlug(plan: Plan): string {
  const slug = planTitle(plan)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${slug || 'utsav-plan'}-${plan.input.eventDate}`;
}

export function downloadFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
