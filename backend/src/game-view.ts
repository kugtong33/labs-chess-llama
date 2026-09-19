import type { GameView } from '@chess-llama/contracts';
import type { GameAggregate } from '@chess-llama/storage';

function date(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function toGameView(game: GameAggregate): GameView {
  return {
    id: game.id,
    status: game.status,
    humanColor: game.humanColor,
    currentFen: game.currentFen,
    pgn: game.pgn,
    result: game.result,
    modelProfileId: game.modelProfileId,
    moves: game.moves.map((move) => ({
      ...move,
      createdAt: date(move.createdAt)!,
    })),
    lastAiDecision:
      game.lastAiDecision === null
        ? null
        : {
            ...game.lastAiDecision,
            createdAt: date(game.lastAiDecision.createdAt)!,
          },
    createdAt: date(game.createdAt)!,
    updatedAt: date(game.updatedAt)!,
    completedAt: date(game.completedAt),
  };
}
