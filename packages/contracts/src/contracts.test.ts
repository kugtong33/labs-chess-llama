import { describe, expect, it } from 'vitest';
import {
  AiMoveRequestSchema,
  CreateGameRequestSchema,
  DecisionTraceEventSchema,
  GameViewSchema,
  HealthResponseSchema,
  SettingsSchema,
  SubmitMoveRequestSchema,
} from './index.js';

describe('public contracts', () => {
  it('accepts valid move requests and rejects stale shapes', () => {
    expect(
      SubmitMoveRequestSchema.parse({ from: 'e2', to: 'e4', expectedPly: 0 }),
    ).toEqual({
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    expect(() =>
      SubmitMoveRequestSchema.parse({ from: 'e9', to: 'e4', expectedPly: -1 }),
    ).toThrow();
    expect(AiMoveRequestSchema.parse({ expectedPly: 1 })).toEqual({
      expectedPly: 1,
    });
  });

  it('applies stable game and settings defaults', () => {
    expect(CreateGameRequestSchema.parse({})).toEqual({});
    const settings = SettingsSchema.parse({
      preferredHumanColor: 'white',
      boardOrientation: 'white',
      theme: 'system',
      commentaryStyle: 'concise',
      modelProfileId: 'qwen3-4b-q4-k-m',
      stockfishCandidateLimit: 5,
      stockfishMoveTimeMs: 100,
    });
    expect(settings.stockfishCandidateLimit).toBe(5);
  });

  it('requires authoritative game fields', () => {
    expect(() =>
      GameViewSchema.parse({ id: 'game-1', status: 'active' }),
    ).toThrow();
  });

  it('names the API service backend in health responses', () => {
    expect(
      HealthResponseSchema.parse({
        status: 'ready',
        components: {
          backend: { status: 'ready' },
          database: { status: 'ready' },
          stockfish: { status: 'ready' },
          model: {
            status: 'ready',
            modelId: 'model',
            profileId: 'profile',
            quantization: 'Q4_K_M',
            backend: 'CUDA',
          },
        },
      }).components.backend,
    ).toEqual({ status: 'ready' });
  });

  it('accepts a strict, versioned llama retry trace event', () => {
    const event = {
      schemaVersion: 1,
      id: '6d217b17-109c-45a4-97c4-f190adad90ce',
      sequence: 0,
      timestamp: '2026-09-18T00:00:00.000Z',
      traceId: 'd722a68e-97c5-43d8-b0ca-1ba91ba3392f',
      requestId: 'req-42',
      gameId: '8fdbe143-cb5b-465d-90e9-70e5a7d19a44',
      ply: 2,
      layer: 'llama',
      stage: 'retry_scheduled',
      status: 'retrying',
      summary: 'Retrying model selection after a timeout.',
      data: { attempt: 1, reason: 'timeout' },
    };

    expect(DecisionTraceEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ['web', 'move_submitted', 'completed', {}],
    [
      'backend',
      'ai_turn_started',
      'running',
      { fen: 'fen', sanHistory: ['e4'], candidateLimit: 5, moveTimeMs: 100 },
    ],
    [
      'stockfish',
      'analysis_completed',
      'completed',
      {
        candidates: [
          {
            rank: 1,
            uci: 'e7e5',
            san: 'e5',
            score: { type: 'cp', value: 20 },
            normalizedScore: 20,
          },
        ],
      },
    ],
    [
      'stockfish',
      'analysis_started',
      'running',
      { candidateLimit: 5, moveTimeMs: 100 },
    ],
    [
      'llama',
      'attempt_started',
      'running',
      {
        attempt: 0,
        profileId: 'profile',
        candidates: [{ rank: 1, uci: 'e7e5', san: 'e5' }],
      },
    ],
    [
      'llama',
      'selection_completed',
      'completed',
      {
        selectedMove: 'e7e5',
        commentary: 'Central control.',
        modelId: 'model',
        retryCount: 0,
        latencyMs: 25,
        promptTokens: null,
        completionTokens: null,
        tokensPerSecond: null,
      },
    ],
    [
      'storage',
      'decision_persisted',
      'completed',
      {
        decisionId: 'aaf18ea8-7ece-4999-95ce-319e3a75e920',
        moveId: 'aaf18ea8-7ece-4999-95ce-319e3a75e921',
        chosenUci: 'e7e5',
      },
    ],
  ] as const)(
    'accepts the curated %s layer variant',
    (layer, stage, status, data) => {
      expect(
        DecisionTraceEventSchema.parse({
          schemaVersion: 1,
          id: '6d217b17-109c-45a4-97c4-f190adad90ce',
          sequence: 0,
          timestamp: '2026-09-18T00:00:00.000Z',
          traceId: 'd722a68e-97c5-43d8-b0ca-1ba91ba3392f',
          requestId: 'req-42',
          gameId: null,
          ply: null,
          layer,
          stage,
          status,
          summary: 'Curated trace summary.',
          data,
        }),
      ).toMatchObject({ layer, stage, status, data });
    },
  );

  it('rejects trace fields and stage data outside the curated contract', () => {
    const event = {
      schemaVersion: 1,
      id: '6d217b17-109c-45a4-97c4-f190adad90ce',
      sequence: 0,
      timestamp: '2026-09-18T00:00:00.000Z',
      traceId: 'd722a68e-97c5-43d8-b0ca-1ba91ba3392f',
      requestId: 'req-42',
      gameId: null,
      ply: null,
      layer: 'llama',
      stage: 'attempt_started',
      status: 'running',
      summary: 'Requesting a model selection.',
      data: {
        attempt: 0,
        profileId: 'profile',
        candidates: [{ rank: 1, uci: 'e7e5', san: 'e5' }],
      },
    };

    expect(() =>
      DecisionTraceEventSchema.parse({
        ...event,
        data: { ...event.data, prompt: 'never expose this' },
      }),
    ).toThrow();
    expect(() =>
      DecisionTraceEventSchema.parse({ ...event, rawResponse: '{}' }),
    ).toThrow();
  });
});
