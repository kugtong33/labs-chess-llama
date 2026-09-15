import { z } from 'zod';

import { ColorSchema } from './game.js';

export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export const CommentaryStyleSchema = z.enum(['concise', 'coach', 'playful']);

export const SettingsSchema = z
  .object({
    preferredHumanColor: ColorSchema,
    boardOrientation: ColorSchema,
    theme: ThemeSchema,
    commentaryStyle: CommentaryStyleSchema,
    modelProfileId: z.string().min(1),
    stockfishCandidateLimit: z.number().int().min(1).max(5),
    stockfishMoveTimeMs: z.number().int().min(25).max(1000),
  })
  .strict();

export const UpdateSettingsRequestSchema = SettingsSchema.partial().strict();

export type Theme = z.infer<typeof ThemeSchema>;
export type CommentaryStyle = z.infer<typeof CommentaryStyleSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
