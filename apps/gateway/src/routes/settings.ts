import type { FastifyInstance } from 'fastify';
import { UpdateSettingsRequestSchema } from '@chess-llama/contracts';
import type { SettingsRepository } from '@chess-llama/storage';

export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: SettingsRepository,
): void {
  app.get('/api/settings', () => settings.get());
  app.put('/api/settings', (request) =>
    settings.update(UpdateSettingsRequestSchema.parse(request.body ?? {})),
  );
}
