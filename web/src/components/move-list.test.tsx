// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AiDecisionView, MoveView } from '@chess-llama/contracts';

import { MoveList } from './move-list.js';

const aiMove: MoveView = {
  id: '11111111-1111-4111-8111-111111111111',
  ply: 1,
  color: 'white',
  actor: 'llm',
  uci: 'e2e4',
  san: 'e4',
  fenAfter: 'fen',
  createdAt: '2026-09-18T00:00:00.000Z',
};
const decision: AiDecisionView = {
  id: '22222222-2222-4222-8222-222222222222',
  moveId: aiMove.id,
  candidates: [
    {
      rank: 1,
      uci: 'e2e4',
      san: 'e4',
      score: { type: 'cp', value: 1 },
      normalizedScore: 1,
    },
  ],
  chosenUci: 'e2e4',
  commentary: 'Opening.',
  modelId: 'qwen3',
  profileId: 'qwen3',
  quantization: 'Q4',
  latencyMs: 1,
  promptTokens: 1,
  completionTokens: 1,
  tokensPerSecond: 1,
  retryCount: 0,
  createdAt: '2026-09-18T00:00:00.000Z',
};

describe('MoveList', () => {
  it('selects an AI decision from a white move when the human is black', async () => {
    const onSelectDecision = vi.fn();
    render(
      <MoveList
        moves={[aiMove]}
        decisions={[decision]}
        onSelectDecision={onSelectDecision}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'e4' }));
    expect(onSelectDecision).toHaveBeenCalledWith(decision);
  });
});
