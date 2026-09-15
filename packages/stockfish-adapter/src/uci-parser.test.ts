import { describe, expect, it } from 'vitest';

import { normalizeScore, parseInfoLine, parseInfoLines } from './index.js';

describe('Stockfish UCI scoring', () => {
  it('parses MultiPV and normalizes mate scores', () => {
    expect(
      parseInfoLine(
        'info depth 14 multipv 2 score cp 34 nodes 10 pv e7e5 g1f3',
      ),
    ).toMatchObject({
      rank: 2,
      score: { type: 'cp', value: 34 },
      uci: 'e7e5',
    });
    expect(normalizeScore({ type: 'mate', value: 3 })).toBe(99_997);
    expect(normalizeScore({ type: 'mate', value: -3 })).toBe(-99_997);
  });

  it('keeps only the last info record for each MultiPV rank', () => {
    const parsed = parseInfoLines([
      'info depth 8 multipv 1 score cp 10 pv e2e4',
      'info depth 8 multipv 2 score cp -20 pv d2d4',
      'info depth 14 multipv 1 score cp 30 pv e2e4',
      'bestmove e2e4',
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed.map(({ rank, score }) => [rank, score.value])).toEqual([
      [1, 30],
      [2, -20],
    ]);
  });
});
