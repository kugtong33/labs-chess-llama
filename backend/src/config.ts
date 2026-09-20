import { z } from 'zod';

export const BackendConfigSchema = z
  .object({
    host: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    port: z.coerce.number().int().min(1024).max(65535).default(3001),
    databasePath: z.string().min(1),
    demoTrace: z.boolean().default(false),
    llamaBaseUrl: z.string().url().default('http://127.0.0.1:8080'),
    llamaBackend: z.enum(['CUDA', 'Metal']).nullable().default(null),
    logLevel: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
  })
  .strict();

export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export function parseBackendConfig(
  environment: Record<string, string | undefined> = process.env,
): BackendConfig {
  return BackendConfigSchema.parse({
    host: environment.HOST,
    port: environment.PORT,
    databasePath: environment.DATABASE_PATH,
    demoTrace: z
      .enum(['1', 'true', '0', 'false'])
      .optional()
      .transform((value) => value === '1' || value === 'true')
      .parse(environment.CHESS_LLAMA_DEMO_TRACE),
    llamaBaseUrl: environment.LLAMA_BASE_URL,
    llamaBackend: environment.LLAMA_BACKEND,
    logLevel: environment.LOG_LEVEL,
  });
}
