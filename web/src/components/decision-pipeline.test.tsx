// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AiDecisionView,
  DecisionTraceEvent,
} from '@chess-llama/contracts';

import { DecisionPipeline } from './decision-pipeline.js';

afterEach(cleanup);

const event = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  sequence: 1,
  timestamp: '2026-09-18T00:00:00.000Z',
  traceId: '22222222-2222-4222-8222-222222222222',
  requestId: 'req-1',
  gameId: '33333333-3333-4333-8333-333333333333',
  ply: 2,
  layer: 'llama',
  stage: 'attempt_started',
  status: 'running',
  summary: 'Model is considering candidates.',
  data: {
    attempt: 0,
    profileId: 'qwen3-4b-q4-k-m',
    candidates: [
      { rank: 1, uci: 'e7e5', san: 'e5' },
      { rank: 2, uci: 'c7c5', san: 'c5' },
    ],
  },
} as const satisfies DecisionTraceEvent;

const decision: AiDecisionView = {
  id: '44444444-4444-4444-8444-444444444444',
  moveId: '55555555-5555-4555-8555-555555555555',
  candidates: [
    {
      rank: 1,
      uci: 'e7e5',
      san: 'e5',
      score: { type: 'cp', value: 24 },
      normalizedScore: 24,
    },
  ],
  chosenUci: 'e7e5',
  commentary: 'Controls the centre.',
  modelId: 'qwen3',
  profileId: 'qwen3-4b-q4-k-m',
  quantization: 'Q4_K_M',
  latencyMs: 42,
  promptTokens: 10,
  completionTokens: 4,
  tokensPerSecond: 20,
  retryCount: 1,
  createdAt: '2026-09-18T00:00:00.000Z',
};

describe('DecisionPipeline', () => {
  it('uses persisted decision data rather than current live events in replay mode', () => {
    render(
      <DecisionPipeline
        events={[
          {
            ...event,
            data: {
              ...event.data,
              candidates: [{ rank: 1, uci: 'c7c5', san: 'c5' }],
            },
          },
        ]}
        decision={decision}
        connection="connected"
        replay
      />,
    );
    expect(screen.getByText('e5')).toBeVisible();
    expect(screen.queryByText('c5')).not.toBeInTheDocument();
  });

  it('shows live stages, ranked candidates, retry state, selection, and technical details', () => {
    render(
      <DecisionPipeline
        events={[
          event,
          {
            ...event,
            id: '66666666-6666-4666-8666-666666666666',
            sequence: 2,
            stage: 'retry_scheduled',
            status: 'retrying',
            summary: 'Retrying.',
            data: { attempt: 1, reason: 'timeout' },
          },
        ]}
        decision={decision}
        connection="connected"
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Decision pipeline' }),
    ).toBeVisible();
    expect(screen.getByText('e5')).toBeVisible();
    expect(screen.getByText(/retrying after timeout/i)).toBeVisible();
    expect(screen.getAllByText(/chosen e7e5/i)).toHaveLength(2);
    expect(screen.getByText('Technical details')).toBeVisible();
  });
});
