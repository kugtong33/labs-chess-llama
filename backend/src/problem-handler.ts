import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { GameServiceError } from './errors.js';

interface ProblemError extends Error {
  code?: string;
  statusCode?: number;
  gameStatus?: 'active' | 'awaiting_ai' | 'completed';
}

function gameIdFrom(request: FastifyRequest): string | undefined {
  const params = request.params as { id?: unknown } | undefined;
  return typeof params?.id === 'string' && /^[0-9a-f-]{36}$/i.test(params.id)
    ? params.id
    : undefined;
}

function mapStatus(error: ProblemError): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof GameServiceError) {
    if (error.code === 'GAME_NOT_FOUND') return 404;
    if (error.code === 'AI_UNAVAILABLE' || error.code === 'AI_INVALID_MOVE')
      return 503;
    if (error.code === 'ILLEGAL_MOVE') return 400;
    return 409;
  }
  if (error.statusCode === 404) return 404;
  return 500;
}

function titleFor(status: number): string {
  return status === 400
    ? 'Invalid request'
    : status === 404
      ? 'Not found'
      : status === 409
        ? 'Conflict'
        : status === 503
          ? 'Service unavailable'
          : 'Internal server error';
}

export function sendProblem(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const candidate: ProblemError =
    error instanceof Error ? error : new Error('Request failed');
  const status = mapStatus(candidate);
  const body: Record<string, unknown> = {
    type: `about:blank#${status}`,
    title: titleFor(status),
    status,
    detail:
      status >= 500 ? 'The request could not be completed.' : candidate.message,
    requestId: request.id,
  };
  const gameId = gameIdFrom(request);
  if (gameId !== undefined) body.gameId = gameId;
  if (candidate.gameStatus !== undefined)
    body.gameStatus = candidate.gameStatus;
  reply.code(status).type('application/problem+json').send(body);
}
