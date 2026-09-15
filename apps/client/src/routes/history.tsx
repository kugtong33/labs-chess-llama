import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { GameView } from '@chess-llama/contracts';

import { useGames, useGateway } from '../api/queries.js';
import { ProblemBanner } from '../components/problem-banner.js';
import { saveBrowserDownload, useAbortScope } from './abort-scope.js';

export function HistoryRoute() {
  const games = useGames();
  const gateway = useGateway();
  const abortable = useAbortScope();
  const download = useMutation({
    mutationFn: (id: string) =>
      abortable((signal) => gateway.getPgn(id, signal)),
    onSuccess: ({ blob, filename }) => saveBrowserDownload(blob, filename),
  });

  if (games.isPending)
    return (
      <p className="route-loading" role="status">
        Loading game history…
      </p>
    );
  if (games.isError) {
    return (
      <ProblemBanner
        error={games.error}
        onReconnect={() => {
          void games.refetch();
        }}
      />
    );
  }

  const sorted = [...games.data].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const resumable = sorted.filter((game) => game.status !== 'completed');
  const completed = sorted.filter((game) => game.status === 'completed');

  return (
    <section className="collection-page" aria-labelledby="history-title">
      <p className="eyebrow">SQLite archive</p>
      <h1 id="history-title">History</h1>
      <GameCollection
        title="Resume"
        games={resumable}
        empty="No games in progress."
        action={(game) => (
          <Link className="button secondary" to={`/games/${game.id}`}>
            Resume game
          </Link>
        )}
      />
      <GameCollection
        title="Completed"
        games={completed}
        empty="Completed games will remain here across restarts."
        action={(game) => (
          <button
            className="button ghost"
            type="button"
            disabled={download.isPending}
            onClick={() => download.mutate(game.id)}
          >
            Download PGN
          </button>
        )}
      />
      <ProblemBanner error={download.error} />
    </section>
  );
}

function GameCollection({
  title,
  games,
  empty,
  action,
}: {
  title: string;
  games: GameView[];
  empty: string;
  action: (game: GameView) => React.ReactNode;
}) {
  return (
    <section className="history-group" aria-labelledby={`${title}-games`}>
      <div className="section-heading">
        <h2 id={`${title}-games`}>{title}</h2>
        <span>{games.length}</span>
      </div>
      {games.length === 0 ? (
        <p className="empty-copy">{empty}</p>
      ) : (
        <div className="game-cards">
          {games.map((game) => (
            <article className="game-card" key={game.id}>
              <div>
                <strong>
                  {game.humanColor === 'white' ? 'White' : 'Black'} ·{' '}
                  {game.result}
                </strong>
                <p>{formatDate(game.updatedAt)}</p>
              </div>
              <span>{game.moves.length} ply</span>
              {action(game)}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
