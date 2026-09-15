import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AiMoveRequestSchema,
  CreateGameRequestSchema,
  ResignRequestSchema,
  SubmitMoveRequestSchema,
} from '@chess-llama/contracts';

import type { GameService } from '../game-service.js';

function idFrom(request: FastifyRequest): string {
  return z
    .string()
    .uuid()
    .parse((request.params as { id: string }).id);
}

async function withAbort<T>(
  request: FastifyRequest,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onClose = () =>
    controller.abort(new DOMException('HTTP connection closed', 'AbortError'));
  request.raw.once('close', onClose);
  try {
    return await operation(controller.signal);
  } finally {
    request.raw.removeListener('close', onClose);
  }
}

export function registerGameRoutes(
  app: FastifyInstance,
  service: GameService,
): void {
  app.post('/api/games', async (request, reply) => {
    const game = await withAbort(request, (signal) =>
      service.createGame(
        CreateGameRequestSchema.parse(request.body ?? {}),
        signal,
      ),
    );
    return reply.code(201).send(game);
  });
  app.get('/api/games', async () => service.listGames());
  app.get('/api/games/:id', async (request) =>
    service.getGame(idFrom(request)),
  );
  app.post('/api/games/:id/moves', async (request) =>
    withAbort(request, (signal) =>
      service.submitHumanMove(
        idFrom(request),
        SubmitMoveRequestSchema.parse(request.body),
        signal,
      ),
    ),
  );
  app.post('/api/games/:id/moves/ai', async (request) =>
    withAbort(request, (signal) =>
      service.retryAiMove(
        idFrom(request),
        AiMoveRequestSchema.parse(request.body),
        signal,
      ),
    ),
  );
  app.post('/api/games/:id/resign', async (request) =>
    service.resignGame(
      idFrom(request),
      ResignRequestSchema.parse(request.body),
    ),
  );
  app.get('/api/games/:id/pgn', async (request, reply) => {
    const id = idFrom(request);
    const pgn = await service.exportPgn(id);
    return reply
      .type('application/x-chess-pgn; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="chess-llama-${id}.pgn"`,
      )
      .send(pgn);
  });
}
