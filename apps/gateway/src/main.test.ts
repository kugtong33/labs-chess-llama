import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlamaCppClient } from '@chess-llama/llama-protocol';
import type {
  SelectMoveRequest,
  SelectMoveProgressEvent,
} from '@chess-llama/llama-protocol';
import { StockfishJsAnalyzer } from '@chess-llama/stockfish-adapter';
import type { GatewayDependencies } from './app.js';
import { buildApp } from './app.js';
import { startGateway } from './main.js';

vi.mock('./app.js', () => ({ buildApp: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('production trace configuration', () => {
  it.each([undefined, '0', 'false', '1', 'true'])(
    'gates collection for %s without changing the opening move',
    async (flag) => {
      vi.stubEnv('DATABASE_PATH', ':memory:');
      vi.stubEnv('CHESS_LLAMA_DEMO_TRACE', flag);
      vi.spyOn(StockfishJsAnalyzer, 'create').mockResolvedValue({
        analyze: () =>
          Promise.resolve([
            {
              rank: 1,
              uci: 'e2e4',
              san: 'e4',
              score: { type: 'cp', value: 20 },
              normalizedScore: 20,
            },
          ]),
        close: () => Promise.resolve(),
      } as unknown as StockfishJsAnalyzer);
      vi.spyOn(LlamaCppClient.prototype, 'selectMove').mockImplementation(
        (request) => {
          notifyProgress(request, { type: 'attempt_started', attempt: 0 });
          return Promise.resolve({
            uci: 'e2e4',
            commentary: 'Central control.',
            modelId: 'model',
            latencyMs: 1,
            promptTokens: null,
            completionTokens: null,
            tokensPerSecond: null,
            retryCount: 0,
          });
        },
      );
      const stop = new Error('stop after exercising startup');
      let dependencies!: GatewayDependencies;
      vi.mocked(buildApp).mockImplementation((input) => {
        dependencies = input;
        return {
          listen: async () => {
            const game = await input.service.createGame({
              humanColor: 'black',
            });
            expect(game.moves.map((move) => move.uci)).toEqual(['e2e4']);
            throw stop;
          },
          close: () => Promise.resolve(input.cleanup?.()),
        } as unknown as ReturnType<typeof buildApp>;
      });
      await expect(startGateway()).rejects.toBe(stop);
      if (flag === '1' || flag === 'true') {
        expect(
          dependencies.traceHub?.snapshot({}).map((event) => event.stage),
        ).toEqual([
          'ai_turn_started',
          'analysis_started',
          'analysis_completed',
          'attempt_started',
          'selection_completed',
          'decision_persisted',
          'ai_turn_completed',
        ]);
      } else {
        expect(dependencies.traceHub?.snapshot({}) ?? []).toEqual([]);
        expect(dependencies.traceHub).toBeUndefined();
      }
    },
  );
});

function notifyProgress(
  request: SelectMoveRequest,
  event: SelectMoveProgressEvent,
): void {
  try {
    void Promise.resolve(request.onProgress?.(event)).catch(() => undefined);
  } catch {
    // Test doubles preserve production's diagnostic-only observer behavior.
  }
}
