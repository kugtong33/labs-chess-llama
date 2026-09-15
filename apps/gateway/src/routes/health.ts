import type { FastifyInstance } from 'fastify';

import type { HealthDependencies } from '../app.js';

export function registerHealthRoute(
  app: FastifyInstance,
  health: HealthDependencies,
): void {
  app.get('/api/health', async () => {
    const [database, stockfish, model] = await Promise.all([
      Promise.resolve(health.database()).catch((error) => ({
        status: 'unavailable' as const,
        detail: error instanceof Error ? error.message : 'database unavailable',
      })),
      Promise.resolve(health.stockfish()).catch((error) => ({
        status: 'unavailable' as const,
        detail:
          error instanceof Error ? error.message : 'Stockfish unavailable',
      })),
      Promise.resolve(health.model()).catch((error) => ({
        status: 'unavailable' as const,
        modelId: null,
        profileId: null,
        quantization: null,
        backend: null,
        detail: error instanceof Error ? error.message : 'model unavailable',
      })),
    ]);
    const statuses = [database.status, stockfish.status, model.status];
    const status = statuses.includes('loading')
      ? 'loading'
      : statuses.includes('unavailable')
        ? 'degraded'
        : 'ready';
    return {
      status,
      components: {
        gateway: { status: 'ready' as const },
        database,
        stockfish,
        model: {
          status: model.status,
          detail: model.detail,
          modelId: model.modelId,
          profileId: model.profileId,
          quantization: model.quantization,
          backend: model.backend,
        },
      },
    };
  });
}
