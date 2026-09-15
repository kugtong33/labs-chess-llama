import { describe, expect, it } from 'vitest';

import { filterCredibleCandidates } from './index.js';

describe('Stockfish candidate credibility', () => {
  it('keeps the best move and alternatives within 150 centipawns', () => {
    const result = filterCredibleCandidates(
      [
        {
          rank: 1,
          uci: 'e7e5',
          san: 'e5',
          score: { type: 'cp', value: 30 },
        },
        {
          rank: 2,
          uci: 'c7c5',
          san: 'c5',
          score: { type: 'cp', value: -40 },
        },
        {
          rank: 3,
          uci: 'f7f6',
          san: 'f6',
          score: { type: 'cp', value: -300 },
        },
      ],
      150,
    );

    expect(result.map(({ uci }) => uci)).toEqual(['e7e5', 'c7c5']);
  });

  it('always retains rank one even when its score is unusual', () => {
    const result = filterCredibleCandidates(
      [
        {
          rank: 2,
          uci: 'c7c5',
          san: 'c5',
          score: { type: 'cp', value: 10 },
        },
        {
          rank: 1,
          uci: 'e7e5',
          san: 'e5',
          score: { type: 'mate', value: 1 },
        },
      ],
      150,
    );

    expect(result.map(({ uci }) => uci)).toEqual(['e7e5']);
  });
});
