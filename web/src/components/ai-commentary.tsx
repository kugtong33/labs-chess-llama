import type { AiDecisionView } from '@chess-llama/contracts';

export function AiCommentary({
  decision,
  backend,
}: {
  decision: AiDecisionView | null;
  backend?: string | null;
}) {
  return (
    <section
      className="panel commentary-panel"
      aria-labelledby="commentary-title"
    >
      <div className="panel-heading">
        <h2 id="commentary-title">Opponent</h2>
        <span>Hybrid AI</span>
      </div>
      {decision ? (
        <>
          <blockquote>{decision.commentary}</blockquote>
          <dl className="telemetry">
            <div>
              <dt>Model</dt>
              <dd>
                {displayModel(decision.modelId)} · {decision.quantization}
              </dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{decision.profileId}</dd>
            </div>
            <div>
              <dt>Quant</dt>
              <dd>{decision.quantization}</dd>
            </div>
            <div>
              <dt>Backend</dt>
              <dd>{backend ?? '—'}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>{decision.latencyMs} ms</dd>
            </div>
            <div>
              <dt>Throughput</dt>
              <dd>
                {decision.tokensPerSecond === null
                  ? '—'
                  : `${decision.tokensPerSecond.toFixed(1)} tok/s`}
              </dd>
            </div>
            <div>
              <dt>Prompt tokens</dt>
              <dd>{decision.promptTokens ?? '—'}</dd>
            </div>
            <div>
              <dt>Output tokens</dt>
              <dd>{decision.completionTokens ?? '—'}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="empty-copy">Commentary appears after the AI responds.</p>
      )}
      <p className="disclosure">
        Stockfish suggests candidates; Qwen via llama.cpp chooses and explains.
      </p>
    </section>
  );
}

function displayModel(modelId: string): string {
  const match = modelId.match(/Qwen3-([\d.]+B)/iu);
  return match?.[1] ? `Qwen3-${match[1]}` : modelId;
}
