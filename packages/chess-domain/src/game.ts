import { Chess, type Move } from 'chess.js';

import type { Color, GameResult, Promotion, Uci } from '@chess-llama/contracts';

import {
  type AppliedMove,
  type HumanMoveInput,
  InvalidMoveError,
  type LegalMove,
  type UciMove,
} from './types.js';

function colorForChessJs(color: 'w' | 'b'): Color {
  return color === 'w' ? 'white' : 'black';
}

function uciForMove(move: Move): Uci {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function legalMoveFor(move: Move): LegalMove {
  return {
    uci: uciForMove(move),
    san: move.san,
    from: move.from,
    to: move.to,
    ...(move.promotion === undefined
      ? {}
      : { promotion: move.promotion as Promotion }),
  };
}

function appliedMoveFor(chess: Chess, move: Move): AppliedMove {
  return {
    ...legalMoveFor(move),
    color: colorForChessJs(move.color),
    fenAfter: chess.fen(),
    pgnAfter: chess.pgn(),
    gameOver: chess.isGameOver(),
    result: deriveGameResult(chess),
  };
}

export function reconstructGame(
  moves: readonly UciMove[],
  initialFen?: string,
): Chess {
  let chess: Chess;

  try {
    chess = new Chess(initialFen);
  } catch (error) {
    throw new InvalidMoveError('Invalid initial FEN', { cause: error });
  }

  for (const move of moves) {
    applyUciMove(chess, move.uci);
  }

  return chess;
}

export function applyHumanMove(
  chess: Chess,
  input: HumanMoveInput,
): AppliedMove {
  try {
    const move = chess.move({
      from: input.from,
      to: input.to,
      ...(input.promotion === undefined ? {} : { promotion: input.promotion }),
    });

    return appliedMoveFor(chess, move);
  } catch (error) {
    throw new InvalidMoveError(`Illegal move: ${input.from}${input.to}`, {
      cause: error,
    });
  }
}

export function applyUciMove(chess: Chess, uci: string): AppliedMove {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);

  if (match === null) {
    throw new InvalidMoveError(`Malformed UCI move: ${uci}`);
  }

  const [, from, to, promotion] = match;

  if (from === undefined || to === undefined) {
    throw new InvalidMoveError(`Malformed UCI move: ${uci}`);
  }

  return applyHumanMove(chess, {
    from,
    to,
    ...(promotion === undefined ? {} : { promotion: promotion as Promotion }),
  });
}

export function legalMoves(chess: Chess): LegalMove[] {
  return chess.moves({ verbose: true }).map(legalMoveFor);
}

export function deriveGameResult(chess: Chess): GameResult {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? '0-1' : '1-0';
  }

  if (
    chess.isStalemate() ||
    chess.isThreefoldRepetition() ||
    chess.isDrawByFiftyMoves() ||
    chess.isInsufficientMaterial()
  ) {
    return '1/2-1/2';
  }

  return '*';
}
