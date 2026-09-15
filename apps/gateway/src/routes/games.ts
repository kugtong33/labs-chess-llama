import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AiMoveRequestSchema,
  CreateGameRequestSchema,
  GameListResponseSchema,
  GameViewSchema,
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

function invalidDependencyResponse(): Error & { statusCode: number } {
  return Object.assign(new Error('Dependency returned an invalid response'), {
    statusCode: 500,
  });
}

function parseView(value: unknown) {
  try {
    return GameViewSchema.parse(value);
  } catch {
    throw invalidDependencyResponse();
  }
}

function parseViews(value: unknown) {
  try {
    return GameListResponseSchema.parse(value);
  } catch {
    throw invalidDependencyResponse();
  }
}

export async function withAbort<T>(
  reply: {
    raw: {
      writableFinished: boolean;
      once: (event: string, listener: () => void) => void;
      removeListener: (event: string, listener: () => void) => void;
    };
  },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let finished = false;
  const onClose = () =>
    !finished &&
    !reply.raw.writableFinished &&
    controller.abort(new DOMException('HTTP connection closed', 'AbortError'));
  reply.raw.once('close', onClose);
  try {
    return await operation(controller.signal);
  } finally {
    finished = true;
    reply.raw.removeListener('close', onClose);
  }
}

export function registerGameRoutes(
  app: FastifyInstance,
  service: GameService,
): void {
  app.post('/api/games', async (request, reply) => {
    const game = await withAbort(reply, (signal) =>
      service.createGame(
        CreateGameRequestSchema.parse(request.body ?? {}),
        signal,
      ),
    );
    return reply.code(201).send(parseView(game));
  });
  app.get('/api/games', async () => parseViews(await service.listGames()));
  app.get('/api/games/:id', async (request) =>
    parseView(await service.getGame(idFrom(request))),
  );
  app.post('/api/games/:id/moves', async (request, reply) => {
    const game = await withAbort(reply, (signal) =>
      service.submitHumanMove(
        idFrom(request),
        SubmitMoveRequestSchema.parse(request.body),
        signal,
      ),
    );
    return parseView(game);
  });
  app.post('/api/games/:id/moves/ai', async (request, reply) => {
    const game = await withAbort(reply, (signal) =>
      service.retryAiMove(
        idFrom(request),
        AiMoveRequestSchema.parse(request.body),
        signal,
      ),
    );
    return parseView(game);
  });
  app.post('/api/games/:id/resign', async (request) =>
    parseView(
      await service.resignGame(
        idFrom(request),
        ResignRequestSchema.parse(request.body),
      ),
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
