import { z } from 'zod';

import { GameStatusSchema } from './game.js';

export const ProblemDetailsSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().min(1),
    requestId: z.string().min(1),
    gameId: z.string().uuid().optional(),
    gameStatus: GameStatusSchema.optional(),
  })
  .strict();

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
