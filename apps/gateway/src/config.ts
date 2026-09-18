import { z } from 'zod';

export const GatewayConfigSchema = z
  .object({
    host: z.literal('127.0.0.1').default('127.0.0.1'),
    port: z.coerce.number().int().min(1024).max(65535).default(3001),
    clientOrigin: z.string().url().default('http://127.0.0.1:5173'),
    databasePath: z.string().min(1),
    demoTrace: z.boolean().default(false),
    llamaBaseUrl: z.string().url().default('http://127.0.0.1:8080'),
    logLevel: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
  })
  .strict();

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function parseGatewayConfig(
  environment: Record<string, string | undefined> = process.env,
): GatewayConfig {
  return GatewayConfigSchema.parse({
    host: environment.HOST,
    port: environment.PORT,
    clientOrigin: environment.CLIENT_ORIGIN,
    databasePath: environment.DATABASE_PATH,
    demoTrace: z
      .enum(['1', 'true', '0', 'false'])
      .optional()
      .transform((value) => value === '1' || value === 'true')
      .parse(environment.CHESS_LLAMA_DEMO_TRACE),
    llamaBaseUrl: environment.LLAMA_BASE_URL,
    logLevel: environment.LOG_LEVEL,
  });
}
