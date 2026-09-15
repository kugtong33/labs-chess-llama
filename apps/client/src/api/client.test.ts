import { describe, expect, it } from 'vitest';

import { GatewayClient, GatewayConnectionError } from './client.js';

const game = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'awaiting_ai',
  humanColor: 'white',
  currentFen: 'fen',
  pgn: '1. e4 *',
  result: '*',
  modelProfileId: 'qwen3-4b-q4-k-m',
  moves: [],
  lastAiDecision: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
};

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('GatewayClient', () => {
  it('parses successful responses and problem details', async () => {
    const responses = [
      jsonResponse(game),
      jsonResponse(
        {
          type: 'ai-unavailable',
          title: 'AI unavailable',
          status: 503,
          detail: 'Model is offline',
          requestId: 'req-1',
          gameId: game.id,
          gameStatus: 'awaiting_ai',
        },
        503,
      ),
    ];
    const client = new GatewayClient('http://127.0.0.1:3001', () =>
      Promise.resolve(responses.shift() as Response),
    );

    expect((await client.getGame(game.id)).id).toBe(game.id);
    await expect(
      client.retryAiMove(game.id, { expectedPly: 1 }),
    ).rejects.toMatchObject({
      status: 503,
      gameStatus: 'awaiting_ai',
    });
  });

  it('turns network failures into a typed connection error', async () => {
    const client = new GatewayClient('http://127.0.0.1:3001', () =>
      Promise.reject(new TypeError('offline')),
    );
    await expect(client.listGames()).rejects.toBeInstanceOf(
      GatewayConnectionError,
    );
  });

  it('downloads PGN as a blob with a safe filename', async () => {
    const client = new GatewayClient('http://127.0.0.1:3001', () =>
      Promise.resolve(
        new Response('1. e4 *', {
          headers: {
            'content-disposition': 'attachment; filename="game-1.pgn"',
          },
        }),
      ),
    );
    const download = await client.getPgn(game.id);
    expect(download.filename).toBe('game-1.pgn');
    expect(await download.blob.text()).toBe('1. e4 *');
  });

  it('uses every approved gateway route and HTTP method', async () => {
    const settings = {
      preferredHumanColor: 'white' as const,
      boardOrientation: 'white' as const,
      theme: 'system' as const,
      commentaryStyle: 'concise' as const,
      modelProfileId: 'qwen3-4b-q4-k-m',
      stockfishCandidateLimit: 3,
      stockfishMoveTimeMs: 200,
    };
    const health = {
      status: 'ready' as const,
      components: {
        gateway: { status: 'ready' as const },
        database: { status: 'ready' as const },
        stockfish: { status: 'ready' as const },
        model: {
          status: 'ready' as const,
          modelId: 'Qwen3-4B-Q4_K_M.gguf',
          profileId: 'qwen3-4b-q4-k-m',
          quantization: 'Q4_K_M',
          backend: 'CUDA',
        },
      },
    };
    const calls: Array<{ path: string; method: string; body?: string }> = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      calls.push({
        path: url.pathname,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (url.pathname === '/api/health')
        return Promise.resolve(jsonResponse(health));
      if (url.pathname === '/api/settings')
        return Promise.resolve(jsonResponse(settings));
      if (url.pathname.endsWith('/pgn'))
        return Promise.resolve(new Response('1. e4 *'));
      if (url.pathname === '/api/games' && !init?.method)
        return Promise.resolve(jsonResponse([]));
      return Promise.resolve(
        jsonResponse(game, init?.method === 'POST' ? 201 : 200),
      );
    };
    const client = new GatewayClient('http://127.0.0.1:3001/', fetcher);

    await client.createGame({ humanColor: 'white' });
    await client.listGames();
    await client.getGame(game.id);
    await client.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    await client.retryAiMove(game.id, { expectedPly: 1 });
    await client.resignGame(game.id, { expectedPly: 1 });
    await client.getSettings();
    await client.updateSettings({ theme: 'dark' });
    await client.health();
    await client.getPgn(game.id);

    expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      'POST /api/games',
      'GET /api/games',
      `GET /api/games/${game.id}`,
      `POST /api/games/${game.id}/moves`,
      `POST /api/games/${game.id}/moves/ai`,
      `POST /api/games/${game.id}/resign`,
      'GET /api/settings',
      'PUT /api/settings',
      'GET /api/health',
      `GET /api/games/${game.id}/pgn`,
    ]);
    expect(calls[0]?.body).toBe('{"humanColor":"white"}');
    expect(calls[4]?.body).toBe('{"expectedPly":1}');
  });
});
