import { describe, expect, it } from 'vitest';

import {
  applyHumanMove,
  applyUciMove,
  deriveGameResult,
  legalMoves,
  reconstructGame,
} from './index.js';

describe('chess domain', () => {
  it('applies and reconstructs authoritative moves', () => {
    const chess = reconstructGame([]);
    const first = applyHumanMove(chess, { from: 'e2', to: 'e4' });

    expect(first).toMatchObject({ uci: 'e2e4', san: 'e4', color: 'white' });
    expect(reconstructGame([{ uci: 'e2e4' }]).fen()).toBe(first.fenAfter);
  });

  it('rejects illegal UCI and handles promotion', () => {
    expect(() => applyUciMove(reconstructGame([]), 'e2e5')).toThrow(
      'Illegal move',
    );

    const promoted = applyUciMove(
      reconstructGame([], '8/P7/8/8/8/8/7k/5K2 w - - 0 1'),
      'a7a8q',
    );

    expect(promoted.uci).toBe('a7a8q');
  });

  it('derives checkmate result', () => {
    const chess = reconstructGame([
      { uci: 'f2f3' },
      { uci: 'e7e5' },
      { uci: 'g2g4' },
      { uci: 'd8h4' },
    ]);

    expect(deriveGameResult(chess)).toBe('0-1');
  });

  it('supports castling and lists serializable legal moves', () => {
    const chess = reconstructGame([
      { uci: 'e2e4' },
      { uci: 'e7e5' },
      { uci: 'g1f3' },
      { uci: 'b8c6' },
      { uci: 'f1e2' },
      { uci: 'g8f6' },
    ]);

    expect(legalMoves(chess)).toContainEqual({
      uci: 'e1g1',
      san: 'O-O',
      from: 'e1',
      to: 'g1',
    });
    expect(applyUciMove(chess, 'e1g1')).toMatchObject({
      san: 'O-O',
      uci: 'e1g1',
    });
  });

  it('applies en passant', () => {
    const chess = reconstructGame([
      { uci: 'e2e4' },
      { uci: 'a7a6' },
      { uci: 'e4e5' },
      { uci: 'd7d5' },
    ]);

    expect(applyUciMove(chess, 'e5d6')).toMatchObject({
      uci: 'e5d6',
      san: 'exd6',
    });
  });

  it('derives draws from stalemate, repetition, fifty-move, and insufficient material', () => {
    expect(
      deriveGameResult(reconstructGame([], '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')),
    ).toBe('1/2-1/2');
    expect(
      deriveGameResult(
        reconstructGame([
          { uci: 'g1f3' },
          { uci: 'g8f6' },
          { uci: 'f3g1' },
          { uci: 'f6g8' },
          { uci: 'g1f3' },
          { uci: 'g8f6' },
          { uci: 'f3g1' },
          { uci: 'f6g8' },
        ]),
      ),
    ).toBe('1/2-1/2');
    expect(
      deriveGameResult(reconstructGame([], '8/8/8/8/8/8/7k/5K1R w - - 100 1')),
    ).toBe('1/2-1/2');
    expect(
      deriveGameResult(reconstructGame([], '8/8/8/8/8/8/7k/5K2 w - - 0 1')),
    ).toBe('1/2-1/2');
  });

  it('rejects malformed UCI without mutating the game', () => {
    const chess = reconstructGame([]);

    expect(() => applyUciMove(chess, 'e2-e4')).toThrow(
      'Malformed UCI move: e2-e4',
    );
    expect(chess.fen()).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
  });
});
