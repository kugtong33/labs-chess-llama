import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import type {
  AiMoveRequest,
  CreateGameRequest,
  GameView,
  Settings,
  SubmitMoveRequest,
} from '@chess-llama/contracts';
import type { ModelHealth } from '@chess-llama/llama-protocol';

import { GameServiceError } from './errors.js';
import { buildApp, type GatewayDependencies } from './app.js';
import { parseGatewayConfig } from './config.js';
import { withAbort } from './routes/games.js';
import { createResourceCleanup, installShutdownHandlers } from './main.js';

const gameId = '11111111-1111-4111-8111-111111111111';
const game: GameView = {
  id: gameId,
  status: 'active',
  humanColor: 'white',
  currentFen: 'fen',
  pgn: '1. e4',
  result: '*',
  modelProfileId: 'profile',
  moves: [],
  lastAiDecision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
};
const settings: Settings = {
  preferredHumanColor: 'white',
  boardOrientation: 'white',
  theme: 'system',
  commentaryStyle: 'concise',
  modelProfileId: 'profile',
  stockfishCandidateLimit: 2,
  stockfishMoveTimeMs: 100,
};

function fakeModel(status: ModelHealth['status'] = 'ready'): ModelHealth {
  return {
    status,
    modelId: status === 'ready' ? 'model' : null,
    profileId: status === 'ready' ? 'profile' : null,
    quantization: status === 'ready' ? 'q4' : null,
    backend: status === 'ready' ? 'llama.cpp' : null,
    ...(status === 'unavailable' ? { detail: 'offline' } : {}),
  };
}

function buildTestApp(
  options: {
    modelStatus?: ModelHealth['status'];
    databaseFailure?: boolean;
    badResponse?: boolean;
  } = {},
) {
  let current = game;
  let submittedSignal: AbortSignal | undefined;
  let cleanupCalls = 0;
  const service = {
    createGame(_input: CreateGameRequest, signal?: AbortSignal) {
      submittedSignal = signal;
      return Promise.resolve(current);
    },
    listGames() {
      return Promise.resolve([current]);
    },
    getGame(id: string) {
      if (options.databaseFailure) throw new Error('sqlite failure');
      if (id !== gameId)
        throw new GameServiceError('GAME_NOT_FOUND', 'not found');
      return Promise.resolve(
        options.badResponse ? { ...current, status: 'invalid' } : current,
      );
    },
    submitHumanMove(
      id: string,
      _input: SubmitMoveRequest,
      signal?: AbortSignal,
    ) {
      submittedSignal = signal;
      if (id !== gameId)
        throw new GameServiceError('GAME_NOT_FOUND', 'not found');
      if (options.modelStatus === 'unavailable')
        throw new GameServiceError('AI_UNAVAILABLE', 'offline', 'awaiting_ai');
      current = {
        ...current,
        moves: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            ply: 1,
            color: 'white',
            actor: 'human',
            uci: 'e2e4',
            san: 'e4',
            fenAfter: 'fen2',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        pgn: '1. e4',
      };
      return Promise.resolve(current);
    },
    retryAiMove(_id: string, _input: AiMoveRequest, signal?: AbortSignal) {
      submittedSignal = signal;
      if (_input.expectedPly !== 0)
        throw new GameServiceError('STALE_PLY', 'stale');
      if (options.modelStatus === 'unavailable')
        throw new GameServiceError('AI_UNAVAILABLE', 'offline', 'awaiting_ai');
      return Promise.resolve(current);
    },
    resignGame() {
      return Promise.resolve({
        ...current,
        status: 'completed' as const,
        result: '0-1' as const,
        pgn: '0-1',
      });
    },
    exportPgn(id: string) {
      if (id !== gameId)
        throw new GameServiceError('GAME_NOT_FOUND', 'not found');
      return Promise.resolve('1. e4 1-0\n');
    },
  };
  const dependencies: GatewayDependencies = {
    service: service as unknown as GatewayDependencies['service'],
    settings: {
      get: () => settings,
      update: (patch) => ({ ...settings, ...patch }),
    },
    health: {
      database: () => ({ status: 'ready' }),
      stockfish: () => ({ status: 'ready' }),
      model: () => fakeModel(options.modelStatus ?? 'ready'),
    },
    config: {
      host: '127.0.0.1',
      port: 3001,
      clientOrigin: 'http://127.0.0.1:5173',
      databasePath: ':memory:',
      llamaBaseUrl: 'http://127.0.0.1:8080',
      logLevel: 'info',
    },
    cleanup: () => {
      cleanupCalls += 1;
    },
  };
  return {
    app: buildApp(dependencies),
    get submittedSignal() {
      return submittedSignal;
    },
    get cleanupCalls() {
      return cleanupCalls;
    },
  };
}

describe('Fastify gateway API', () => {
  it('uses the approved move and PGN routes', async () => {
    const harness = buildTestApp();
    const app = harness.app;
    const created = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const moved = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/moves`,
      payload: { from: 'e2', to: 'e4', expectedPly: 0 },
    });
    expect(moved.statusCode).toBe(200);
    const pgn = await app.inject({
      method: 'GET',
      url: `/api/games/${gameId}/pgn`,
    });
    expect(pgn.statusCode).toBe(200);
    expect(pgn.headers['content-type']).toContain('application/x-chess-pgn');
    expect(pgn.headers['content-disposition']).toContain(
      `chess-llama-${gameId}.pgn`,
    );
  });

  it('covers list/get/AI/resign/settings routes', async () => {
    const app = buildTestApp().app;
    expect(
      (await app.inject({ method: 'GET', url: '/api/games' })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/games/${gameId}` }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/games/${gameId}/moves/ai`,
          payload: { expectedPly: 0 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/games/${gameId}/resign`,
          payload: { expectedPly: 0 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/settings' })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/settings',
          payload: { theme: 'dark' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('maps validation, missing games, and stale ply to problem+json', async () => {
    const app = buildTestApp().app;
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/moves`,
      payload: { from: 'e2', to: 'e4' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/games/${crypto.randomUUID()}`,
        })
      ).statusCode,
    ).toBe(404);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/moves/ai`,
      payload: { expectedPly: 99 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers['content-type']).toContain('application/problem+json');
  });

  it('returns health, configured CORS, and a request ID', async () => {
    const app = buildTestApp().app;
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    expect(response.statusCode).toBe(200);
    const health = response.json<{ status?: string }>();
    expect(health.status).toBe('ready');
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:5173',
    );
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('reports model unavailability and preserves saved game extensions', async () => {
    const app = buildTestApp({ modelStatus: 'unavailable' }).app;
    const response = await app.inject({
      method: 'POST',
      url: `/api/games/${gameId}/moves/ai`,
      payload: { expectedPly: 0 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      gameId,
      gameStatus: 'awaiting_ai',
    });
  });

  it('sanitizes unexpected database failures as a 500 problem', async () => {
    const response = await buildTestApp({ databaseFailure: true }).app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    const problem = response.json<{ detail?: string; stack?: string }>();
    expect(problem.detail).not.toContain('sqlite');
    expect(problem.stack).toBeUndefined();
  });

  it('rejects invalid dependency JSON at the shared response boundary', async () => {
    const response = await buildTestApp({ badResponse: true }).app.inject({
      method: 'GET',
      url: `/api/games/${gameId}`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
  });

  it('passes HTTP abort signals to game operations', async () => {
    const harness = buildTestApp();
    await harness.app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {},
    });
    expect(harness.submittedSignal).toBeInstanceOf(AbortSignal);
    expect(harness.submittedSignal?.aborted).toBe(false);
  });

  it('runs shutdown cleanup at most once', async () => {
    const harness = buildTestApp();
    await harness.app.close();
    await harness.app.close();
    expect(harness.cleanupCalls).toBe(1);
  });

  it('aborts only on a premature response close', async () => {
    const raw = new EventEmitter() as EventEmitter & {
      writableFinished: boolean;
    };
    raw.writableFinished = false;
    const reply = { raw };
    let operationSignal: AbortSignal | undefined;
    let release!: () => void;
    const pending = withAbort(reply, (signal) => {
      operationSignal = signal;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    raw.emit('close');
    expect(operationSignal?.aborted).toBe(true);
    release();
    await pending;

    const completedRaw = new EventEmitter() as EventEmitter & {
      writableFinished: boolean;
    };
    completedRaw.writableFinished = true;
    let completedSignal!: AbortSignal;
    await withAbort({ raw: completedRaw }, (signal) => {
      completedSignal = signal;
      return Promise.resolve();
    });
    completedRaw.emit('close');
    expect(completedSignal.aborted).toBe(false);
  });

  it('closes the app once for process signals and removes both handlers', async () => {
    const processLike = new EventEmitter() as EventEmitter & {
      exitCode?: number;
    };
    let appCloseCalls = 0;
    installShutdownHandlers(processLike, {
      close: () =>
        Promise.resolve().then(() => {
          appCloseCalls += 1;
        }),
    });
    processLike.emit('SIGTERM');
    processLike.emit('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));
    expect(appCloseCalls).toBe(1);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
  });

  it('reports shutdown failures and removes handlers after a rejected close', async () => {
    const processLike = new EventEmitter() as EventEmitter & {
      exitCode?: number;
    };
    const closeError = new Error('close failed');
    const errors: Array<{ error: unknown; signal: string }> = [];
    installShutdownHandlers(
      processLike,
      { close: () => Promise.reject(closeError) },
      { error: (error, signal) => errors.push({ error, signal }) },
    );
    processLike.emit('SIGINT');
    processLike.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toEqual([{ error: closeError, signal: 'SIGINT' }]);
    expect(processLike.exitCode).toBe(1);
    expect(processLike.listenerCount('SIGTERM')).toBe(0);
    expect(processLike.listenerCount('SIGINT')).toBe(0);
  });

  it('attempts database cleanup after Stockfish failure and reuses its rejection', async () => {
    let databaseCloseCalls = 0;
    let stockfishCloseCalls = 0;
    const closeError = new Error('stockfish close failed');
    const cleanup = createResourceCleanup(
      {
        open: true,
        close: () => {
          databaseCloseCalls += 1;
        },
      },
      {
        close: () => {
          stockfishCloseCalls += 1;
          return Promise.reject(closeError);
        },
      },
    );
    await expect(cleanup()).rejects.toBe(closeError);
    await expect(cleanup()).rejects.toBe(closeError);
    expect(stockfishCloseCalls).toBe(1);
    expect(databaseCloseCalls).toBe(1);
  });

  it('defaults to loopback-only configuration and rejects non-loopback hosts', () => {
    expect(parseGatewayConfig({ DATABASE_PATH: ':memory:' }).host).toBe(
      '127.0.0.1',
    );
    expect(() =>
      parseGatewayConfig({ HOST: '0.0.0.0', DATABASE_PATH: ':memory:' }),
    ).toThrow();
  });
});
