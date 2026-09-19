import { useHealth } from '../api/queries.js';

export function RuntimeStatus() {
  const health = useHealth();

  if (health.isPending) {
    return (
      <aside className="runtime-status is-loading" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        Checking local runtime…
      </aside>
    );
  }

  if (health.isError) {
    return (
      <aside className="runtime-status is-unavailable" role="status">
        <span className="status-dot" aria-hidden="true" />
        <span>
          Backend unavailable. Run <code>chess-llama backend start</code>.
        </span>
      </aside>
    );
  }

  const model = health.data.components.model;
  if (health.data.status !== 'ready') {
    return (
      <aside className="runtime-status is-degraded" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span>
          {model.status === 'unavailable' ? (
            <>
              Model offline. Run <code>chess-llama model start</code>.
            </>
          ) : (
            <>Local runtime is {health.data.status}.</>
          )}
        </span>
      </aside>
    );
  }

  return (
    <aside className="runtime-status is-ready" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <span>
        Local AI ready
        {model.profileId ? ` · ${model.profileId}` : ''}
        {model.quantization ? ` · ${model.quantization}` : ''}
      </span>
    </aside>
  );
}
