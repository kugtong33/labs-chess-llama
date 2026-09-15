import { GatewayConnectionError, GatewayProblemError } from '../api/client.js';

export function ProblemBanner({
  error,
  onReconnect,
}: {
  error: unknown;
  onReconnect?: () => void;
}) {
  if (!error) return null;
  const problem = error instanceof GatewayProblemError ? error : undefined;
  const connection = error instanceof GatewayConnectionError;
  const detail =
    problem?.detail ??
    (error instanceof Error ? error.message : 'An unexpected error occurred');

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
