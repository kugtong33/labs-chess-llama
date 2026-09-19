import type { FastifyInstance } from 'fastify';
import {
  SettingsSchema,
  UpdateSettingsRequestSchema,
} from '@chess-llama/contracts';
import type { SettingsRepository } from '@chess-llama/storage';

export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: SettingsRepository,
): void {
  const parseSettings = (value: unknown) => {
    try {
      return SettingsSchema.parse(value);
    } catch {
      throw Object.assign(
        new Error('Dependency returned an invalid response'),
        { statusCode: 500 },
      );
    }
  };
  app.get('/api/settings', () => parseSettings(settings.get()));
  app.put('/api/settings', (request) =>
    parseSettings(
      settings.update(UpdateSettingsRequestSchema.parse(request.body ?? {})),
    ),
  );
}
