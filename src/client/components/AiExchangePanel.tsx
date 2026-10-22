import type { AiExchange } from '../../shared/schemas';

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function pretty(reply: string): string {
  try {
    return JSON.stringify(JSON.parse(reply), null, 2);
  } catch {
    return reply;
  }
}

/** Shows the exact prompt sent to the model and its raw reply, as plain text. */
export function AiExchangePanel({ exchange, sample, open }: { exchange: AiExchange; sample: boolean; open: boolean }) {
  return (
    <details className="exchange" open={open}>
      <summary>{sample ? 'Sample data: the prompt that would be sent, and the fixed reply' : 'What was sent to Gemini and what it returned'}</summary>
      <p className="muted">
        Latest {exchange.kind === 'plan' ? 'plan generation' : 'change'}, {when.format(new Date(exchange.at))}, model {exchange.model}. The app
        validates this reply and recalculates every amount and date before showing it.
      </p>
      <div className="exchange-grid">
        <section aria-labelledby="exchange-prompt">
          <h4 id="exchange-prompt">Prompt</h4>
          <pre tabIndex={0}>{exchange.prompt}</pre>
        </section>
        <section aria-labelledby="exchange-reply">
          <h4 id="exchange-reply">Reply (structured JSON)</h4>
          <pre tabIndex={0}>{pretty(exchange.reply)}</pre>
        </section>
      </div>
    </details>
  );
}
