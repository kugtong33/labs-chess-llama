import type { AiDecisionView, MoveView } from '@chess-llama/contracts';

export function MoveList({
  moves,
  decisions = [],
  selectedDecisionId,
  onSelectDecision,
}: {
  moves: MoveView[];
  decisions?: AiDecisionView[];
  selectedDecisionId?: string | null;
  onSelectDecision?: (decision: AiDecisionView) => void;
}) {
  const rows = Array.from(
    { length: Math.ceil(moves.length / 2) },
    (_, index) => ({
      number: index + 1,
      white: moves[index * 2],
      black: moves[index * 2 + 1],
    }),
  );

  return (
    <section className="panel move-panel" aria-labelledby="moves-title">
      <div className="panel-heading">
        <h2 id="moves-title">Moves</h2>
        <span>{moves.length} ply</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty-copy">The opening move is yours.</p>
      ) : (
        <ol className="move-list">
          {rows.map((row) => (
            <li key={row.number}>
              <span>{row.number}.</span>
              {moveCell(
                row.white,
                decisions,
                selectedDecisionId,
                onSelectDecision,
              )}
              {moveCell(
                row.black,
                decisions,
                selectedDecisionId,
                onSelectDecision,
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function moveCell(
  move: MoveView | undefined,
  decisions: AiDecisionView[],
  selectedDecisionId: string | null | undefined,
  onSelectDecision: ((decision: AiDecisionView) => void) | undefined,
) {
  if (!move) return <strong>…</strong>;
  const decision = decisions.find((item) => item.moveId === move.id);
  if (!decision || !onSelectDecision) return <strong>{move.san}</strong>;
  return (
    <button
      type="button"
      className={
        decision.id === selectedDecisionId
          ? 'move-choice is-selected'
          : 'move-choice'
      }
      onClick={() => onSelectDecision(decision)}
      aria-pressed={decision.id === selectedDecisionId}
    >
      {move.san}
    </button>
  );
}
