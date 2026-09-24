import { useState } from 'react';
import { ViewportDialog } from './viewport-dialog.js';
import { PagedContent } from './paged-content.js';
import { BackendConnectionError, BackendProblemError } from '../api/backend.js';

export function ProblemBanner({
  error,
  onReconnect,
  compact = false,
}: {
  error: unknown;
  compact?: boolean;
  onReconnect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!error) return null;
  const problem = error instanceof BackendProblemError ? error : undefined;
  const connection = error instanceof BackendConnectionError;
  const detail =
    problem?.detail ??
    (error instanceof Error ? error.message : 'An unexpected error occurred');

  if (compact)
    return (
      <>
        <div className="game-problem" role="alert">
          <strong>Game needs attention</strong>
          <button
            type="button"
            className="button secondary"
            onClick={() => setExpanded(true)}
          >
            Error details
          </button>
          {connection && onReconnect ? (
            <button
              type="button"
              className="button secondary"
              onClick={onReconnect}
            >
              Reconnect
            </button>
          ) : null}
        </div>
        {expanded ? (
          <ViewportDialog
            title="Game problem"
            onClose={() => setExpanded(false)}
          >
            <PagedContent label="Error details">
              <ProblemBanner error={error} onReconnect={onReconnect} />
            </PagedContent>
          </ViewportDialog>
        ) : null}
      </>
    );

  return (
    <div className="problem-banner" role="alert">
      <div>
        <strong>{problem?.title ?? 'Local service unavailable'}</strong>
        <p>{detail}</p>
        {problem?.status === 503 ? (
          <p>
            Run <code>chess-llama model start</code>, then retry the AI move.
          </p>
        ) : null}
      </div>
      {connection && onReconnect ? (
        <button
          className="button secondary"
          type="button"
          onClick={onReconnect}
        >
          Reconnect
        </button>
      ) : null}
    </div>
  );
}
