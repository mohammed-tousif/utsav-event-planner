import { useEffect, useRef, useState } from 'react';
import { EVENT_TYPE_LABELS, type EventType } from '../../shared/constants';

interface GeneratingProps {
  eventType: EventType;
  sample: boolean;
  onCancel: () => void;
}

/**
 * Honest waiting state: an elapsed-time counter and what is happening,
 * without pretending to know which part of the plan is being written.
 */
export function Generating({ eventType, sample, onCancel }: GeneratingProps) {
  const [seconds, setSeconds] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="page narrow generating" aria-busy="true">
      <div className="garland" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <h1 ref={headingRef} tabIndex={-1}>
        Drafting your {EVENT_TYPE_LABELS[eventType].toLowerCase()} plan
      </h1>
      <p role="status">
        {sample
          ? 'Loading sample content.'
          : 'Google Gemini is writing the budget split, timeline, vendor checklist and ideas. The app then checks every number.'}
      </p>
      <p className="elapsed">
        {seconds < 45 ? 'This usually takes 15 to 45 seconds.' : 'Still working. Large plans can take up to two minutes.'}{' '}
        <span className="tabular">{seconds}s</span>
      </p>
      <button type="button" className="button quiet" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
