import type { StatusResponse } from '../../../shared/api';

function aiStatusText(status: StatusResponse): string {
  if (status.ai.sampleData) return 'Sample data mode: no AI connected';
  return status.ai.configured ? 'Plans drafted by Google Gemini' : 'AI not configured on this server';
}

function Wordmark() {
  return (
    <a className="wordmark" href="#/" aria-label="Utsav home">
      <svg aria-hidden="true" viewBox="0 0 32 32" width="28" height="28">
        <rect width="32" height="32" rx="8" className="wordmark-tile" />
        <g className="wordmark-petals">
          <circle cx="16" cy="9" r="3.2" />
          <circle cx="9.5" cy="13" r="2.6" />
          <circle cx="22.5" cy="13" r="2.6" />
          <circle cx="12" cy="20" r="2.2" />
          <circle cx="20" cy="20" r="2.2" />
          <circle cx="16" cy="25" r="1.8" />
        </g>
      </svg>
      <span>Utsav</span>
    </a>
  );
}

/** Skip link, wordmark and an honest line about whether AI is connected. */
export function SiteHeader({ status }: { status: StatusResponse | null }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header no-print">
        <Wordmark />
        {status && (
          <p className="ai-status" data-sample={status.ai.sampleData || undefined}>
            {aiStatusText(status)}
          </p>
        )}
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer no-print">
      <p>
        Costs and lead times are AI-assisted estimates, not quotes. Utsav does not check real vendor availability. Plans are saved only in
        this browser.
      </p>
    </footer>
  );
}
