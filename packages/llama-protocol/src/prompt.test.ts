import { describe, expect, it } from 'vitest';

import { buildMoveResponseFormat, buildPrompt } from './index.js';

const candidates = [
  { rank: 1, uci: 'e7e5', san: 'e5', normalizedScore: 30 },
  { rank: 2, uci: 'c7c5', san: 'c5', normalizedScore: -40 },
];

describe('llama prompt translation', () => {
  it('builds an enum restricted to candidate UCI moves', () => {
    const format = buildMoveResponseFormat(candidates);
    expect(format.json_schema.schema.properties.move.enum).toEqual([
      'e7e5',
      'c7c5',
    ]);
    expect(format.json_schema.schema.properties.commentary.maxLength).toBe(240);
  });

  it('prompts for no-think output without exposing engine scores', () => {
    const prompt = buildPrompt({
      fen: 'fen',
      sanHistory: ['e4'],
      candidates,
      commentaryStyle: 'concise',
    });
    expect(prompt).toContain('/no_think');
    expect(prompt).toContain('e7e5 (e5)');
    expect(prompt).not.toContain('-40');
  });
});
