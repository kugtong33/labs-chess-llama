import type {
  AiDecisionView,
  DecisionTraceEvent,
} from '@chess-llama/contracts';

import type { DecisionConnection } from '../api/decision-events.js';

const stages = [
  ['client', 'Request'],
  ['gateway', 'Gateway'],
  ['stockfish', 'Stockfish'],
  ['llama', 'Llama'],
  ['storage', 'Saved'],
] as const;

export function DecisionPipeline({
  events,
  decision,
  connection,
}: {
  events: DecisionTraceEvent[];
  decision: AiDecisionView | null;
  connection: DecisionConnection;
}) {
  const candidates = candidatesFrom(events, decision);
  const latest = events.at(-1);
  return (
    <section
      className="panel decision-pipeline"
      aria-labelledby="pipeline-title"
    >
      <div className="panel-heading">
        <h2 id="pipeline-title">Decision pipeline</h2>
        <span>{connection === 'disabled' ? 'Replay' : connection}</span>
      </div>
      <ol className="pipeline-stages" aria-label="Five decision stages">
        {stages.map(([layer, label]) => {
          const layerEvents = events.filter((event) => event.layer === layer);
          const status = layerEvents.at(-1)?.status ?? 'waiting';
          return (
            <li key={layer} data-status={status}>
              {label}
              <span>{status}</span>
            </li>
          );
        })}
      </ol>
      {candidates.length > 0 && (
        <ol className="pipeline-candidates" aria-label="Ranked candidate moves">
          {candidates.map((candidate) => (
            <li
              key={candidate.uci}
              className={
                candidate.uci === decision?.chosenUci ? 'is-chosen' : undefined
              }
            >
              <span>#{candidate.rank}</span> <strong>{candidate.san}</strong>{' '}
              <code>{candidate.uci}</code>
              {candidate.uci === decision?.chosenUci && (
                <em>Chosen {candidate.uci}</em>
              )}
            </li>
          ))}
        </ol>
      )}
      {latest?.stage === 'retry_scheduled' && (
        <p className="pipeline-status" aria-live="polite">
          Retrying after {latest.data.reason}.
        </p>
      )}
      {latest?.status === 'failed' && (
        <p className="pipeline-status" aria-live="polite">
          Decision failed: {latest.summary}
        </p>
      )}
      {latest?.status === 'cancelled' && (
        <p className="pipeline-status" aria-live="polite">
          Decision cancelled.
        </p>
      )}
      {decision && (
        <p className="pipeline-status" aria-live="polite">
          {decision.retryCount === 1 ? 'Retried once. ' : ''}Chosen{' '}
          {decision.chosenUci}.
        </p>
      )}
      <details className="pipeline-details">
        <summary>Technical details</summary>
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              {event.timestamp} · {event.layer} · {event.stage} ·{' '}
              {event.summary}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function candidatesFrom(
  events: DecisionTraceEvent[],
  decision: AiDecisionView | null,
) {
  const attempt = [...events]
    .reverse()
    .find((event) => event.stage === 'attempt_started');
  if (attempt?.stage === 'attempt_started') return attempt.data.candidates;
  return decision?.candidates ?? [];
}
