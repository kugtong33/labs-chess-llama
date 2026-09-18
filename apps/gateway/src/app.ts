import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ComponentHealth } from '@chess-llama/contracts';
import type { ModelHealth, MoveSelector } from '@chess-llama/llama-protocol';
import type { SettingsRepository } from '@chess-llama/storage';

import type { GatewayConfig } from './config.js';
import { sendProblem } from './problem-handler.js';
import { registerGameRoutes } from './routes/games.js';
import { registerHealthRoute } from './routes/health.js';
import { registerSettingsRoutes } from './routes/settings.js';
import type { GameService } from './game-service.js';
import type { DecisionTraceHub } from './decision-trace-hub.js';
import { registerDemoEventRoutes } from './routes/demo-events.js';

export interface HealthDependencies {
  database: () => ComponentHealth | Promise<ComponentHealth>;
  stockfish: () => ComponentHealth | Promise<ComponentHealth>;
  model: (signal?: AbortSignal) => ModelHealth | Promise<ModelHealth>;
}

export interface GatewayDependencies {
  service: GameService;
  settings: SettingsRepository;
  health: HealthDependencies;
  config: GatewayConfig;
  selector?: MoveSelector;
  traceHub?: DecisionTraceHub;
  cleanup?: () => void | Promise<void>;
}

export function buildApp(dependencies: GatewayDependencies): FastifyInstance {
  const app = Fastify({
    logger: {
      level: dependencies.config.logLevel,
      redact: [
        'req.body.prompt',
        'req.body.messages',
        'req.body.response_format',
        'res.body.prompt',
        'res.body.response',
      ],
    },
  });
  const unsubscribeTraceLog = dependencies.traceHub?.subscribe({}, (event) => {
    app.log.info(
      {
        layer: event.layer,
        traceId: event.traceId,
        requestId: event.requestId,
        gameId: event.gameId,
        ply: event.ply,
        stage: event.stage,
        status: event.status,
      },
      event.summary,
    );
  });
  let cleanedUp = false;
  app.addHook('onClose', async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    unsubscribeTraceLog?.();
    await dependencies.cleanup?.();
  });
  void app.register(cors, {
    origin: dependencies.config.clientOrigin,
    methods: ['GET', 'HEAD', 'POST', 'PUT'],
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.setErrorHandler((error, request, reply) => {
    sendProblem(error, request, reply);
  });
  app.setNotFoundHandler((request, reply) => {
    sendProblem(
      Object.assign(new Error('Route not found'), { statusCode: 404 }),
      request,
      reply,
    );
  });
  void registerHealthRoute(app, dependencies.health);
  void registerSettingsRoutes(app, dependencies.settings);
  void registerGameRoutes(app, dependencies.service);
  if (dependencies.config.demoTrace && dependencies.traceHub) {
    registerDemoEventRoutes(app, dependencies.traceHub);
  }
  return app;
}

export { GatewayConfigSchema, parseGatewayConfig } from './config.js';
