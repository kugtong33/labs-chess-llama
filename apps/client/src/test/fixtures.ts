import type {
  GameView,
  HealthResponse,
  Settings,
} from '@chess-llama/contracts';

import type { GatewayApi } from '../api/client.js';

export const gameId = '11111111-1111-4111-8111-111111111111';
const now = '2026-09-15T00:00:00.000Z';

export const readyHealth: HealthResponse = {
  status: 'ready',
  components: {
    gateway: { status: 'ready' },
    database: { status: 'ready' },
    stockfish: { status: 'ready' },
    model: {
      status: 'ready',
      modelId: 'Qwen3-4B-Q4_K_M.gguf',
      profileId: 'qwen3-4b-q4-k-m',
      quantization: 'Q4_K_M',
      backend: 'CUDA',
    },
  },
};

export const settings: Settings = {
  preferredHumanColor: 'white',
  boardOrientation: 'white',
  theme: 'system',
  commentaryStyle: 'concise',
  modelProfileId: 'qwen3-4b-q4-k-m',
  stockfishCandidateLimit: 5,
  stockfishMoveTimeMs: 100,
};

export function game(overrides: Partial<GameView> = {}): GameView {
  return {
    id: gameId,
    status: 'active',
    humanColor: 'white',
    currentFen: 'start',
    pgn: '*',
    result: '*',
    modelProfileId: 'qwen3-4b-q4-k-m',
    moves: [],
    lastAiDecision: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

export function gameAfterTurn(): GameView {
  return game({
    currentFen: 'after-e5',
    pgn: '1. e4 e5 *',
    moves: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        ply: 1,
        color: 'white',
        actor: 'human',
        uci: 'e2e4',
        san: 'e4',
        fenAfter: 'after-e4',
        createdAt: now,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        ply: 2,
        color: 'black',
        actor: 'llm',
        uci: 'e7e5',
        san: 'e5',
        fenAfter: 'after-e5',
        createdAt: now,
      },
    ],
    lastAiDecision: {
      id: '44444444-4444-4444-8444-444444444444',
      moveId: '33333333-3333-4333-8333-333333333333',
      candidates: [
        {
          rank: 1,
          uci: 'e7e5',
          san: 'e5',
          score: { type: 'cp', value: 20 },
          normalizedScore: 20,
        },
      ],
      chosenUci: 'e7e5',
      commentary: 'I challenge your center.',
      modelId: 'Qwen3-4B-Q4_K_M.gguf',
      profileId: 'qwen3-4b-q4-k-m',
      quantization: 'Q4_K_M',
      latencyMs: 420,
      promptTokens: 90,
      completionTokens: 12,
      tokensPerSecond: 28.4,
      retryCount: 0,
      createdAt: now,
    },
  });
}

export function fakeGateway(overrides: Partial<GatewayApi> = {}): GatewayApi {
  const current = game();
  return {
    health: () => Promise.resolve(readyHealth),
    listGames: () => Promise.resolve([current]),
    getGame: () => Promise.resolve(current),
    getDecisions: () => Promise.resolve([]),
    decisionEventsUrl: (id) =>
      `/api/demo/events?gameId=${encodeURIComponent(id)}`,
    createGame: () => Promise.resolve(current),
    submitHumanMove: () => Promise.resolve(gameAfterTurn()),
    retryAiMove: () => Promise.resolve(gameAfterTurn()),
    resignGame: () =>
      Promise.resolve(
        game({ status: 'completed', result: '0-1', completedAt: now }),
      ),
    getSettings: () => Promise.resolve(settings),
    updateSettings: (request) => Promise.resolve({ ...settings, ...request }),
    getPgn: () =>
      Promise.resolve({ blob: new Blob(['1. e4 *']), filename: 'game.pgn' }),
    ...overrides,
  };
}
