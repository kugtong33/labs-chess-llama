import { describe, expect, it } from 'vitest';

import { legalMoves, reconstructGame } from '@chess-llama/chess-domain';

import { StockfishJsAnalyzer } from './index.js';

describe('Stockfish.js integration', () => {
  it('returns legal candidates from Stockfish.js lite-single', async () => {
    const analyzer = await StockfishJsAnalyzer.create();
    try {
      const chess = reconstructGame([{ uci: 'e2e4' }]);
      const candidates = await analyzer.analyze({
        fen: chess.fen(),
        legalMoves: legalMoves(chess),
        candidateLimit: 5,
        moveTimeMs: 25,
        maxLossCp: 150,
      });

      expect(candidates.length).toBeGreaterThan(0);
      expect(legalMoves(chess).map((move) => move.uci)).toContain(
        candidates[0]?.uci,
      );
      expect(new Set(candidates.map(({ rank }) => rank)).size).toBe(
        candidates.length,
      );
    } finally {
      await analyzer.close();
    }
  }, 20_000);

  it('aborts an active search and recreates the engine for the next request', async () => {
    const analyzer = await StockfishJsAnalyzer.create();
    const chess = reconstructGame([{ uci: 'e2e4' }]);
    const controller = new AbortController();
    try {
      const aborted = analyzer.analyze({
        fen: chess.fen(),
        legalMoves: legalMoves(chess),
        candidateLimit: 5,
        moveTimeMs: 5_000,
        maxLossCp: 150,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 10);
      await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

      const candidates = await analyzer.analyze({
        fen: chess.fen(),
        legalMoves: legalMoves(chess),
        candidateLimit: 2,
        moveTimeMs: 25,
        maxLossCp: 150,
      });
      expect(candidates.length).toBeGreaterThan(0);
      expect(legalMoves(chess).map((move) => move.uci)).toContain(
        candidates[0]?.uci,
      );
    } finally {
      await analyzer.close();
    }
  }, 30_000);
});
