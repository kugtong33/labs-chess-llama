import type { MoveView } from '@chess-llama/contracts';

export function MoveList({ moves }: { moves: MoveView[] }) {
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
              <strong>{row.white?.san ?? '…'}</strong>
              <strong>{row.black?.san ?? '…'}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
