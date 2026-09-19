import { z } from 'zod';

export const ComponentHealthSchema = z
  .object({
    status: z.enum(['ready', 'loading', 'unavailable']),
    detail: z.string().optional(),
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    status: z.enum(['ready', 'loading', 'degraded']),
    components: z
      .object({
        backend: ComponentHealthSchema,
        database: ComponentHealthSchema,
        stockfish: ComponentHealthSchema,
        model: ComponentHealthSchema.extend({
          modelId: z.string().nullable(),
          profileId: z.string().nullable(),
          quantization: z.string().nullable(),
          backend: z.string().nullable(),
        }),
      })
      .strict(),
  })
  .strict();

export type ComponentHealth = z.infer<typeof ComponentHealthSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
