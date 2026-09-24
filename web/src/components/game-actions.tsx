import type { ReactNode } from 'react';

export interface GameActionsProps {
  children?: ReactNode;
  canCreate: boolean;
  canResign: boolean;
  canRetry: boolean;
  pending: boolean;
  onNewGame: () => void;
  onResign: () => void;
  onRetry: () => void;
  onDownload: () => void;
}

export function GameActions({
  children,
  canCreate,
  canResign,
  canRetry,
  pending,
  onNewGame,
  onResign,
  onRetry,
  onDownload,
}: GameActionsProps) {
  return (
    <div className="game-actions" role="group" aria-label="Game actions">
      {children}
      <button
        className="button primary"
        type="button"
        onClick={onNewGame}
        disabled={pending || !canCreate}
      >
        New Game
      </button>
      {canRetry ? (
        <button
          className="button warning"
          type="button"
          onClick={onRetry}
          disabled={pending}
        >
          Retry AI move
        </button>
      ) : null}
      {canResign ? (
        <button
          className="button secondary"
          type="button"
          onClick={onResign}
          disabled={pending}
        >
          Resign
        </button>
      ) : null}
      <button
        className="button ghost"
        type="button"
        onClick={onDownload}
        disabled={pending}
      >
        Download PGN
      </button>
    </div>
  );
}
