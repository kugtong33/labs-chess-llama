import { z } from 'zod';

export const SquareSchema = z.string().regex(/^[a-h][1-8]$/);
export const ColorSchema = z.enum(['white', 'black']);
export const GameStatusSchema = z.enum(['active', 'awaiting_ai', 'completed']);
export const GameResultSchema = z.enum(['1-0', '0-1', '1/2-1/2', '*']);
export const MoveActorSchema = z.enum(['human', 'llm']);
export const PromotionSchema = z.enum(['q', 'r', 'b', 'n']);
export const UciSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
export const PlySchema = z.number().int().nonnegative();

export const SubmitMoveRequestSchema = z
  .object({
    from: SquareSchema,
    to: SquareSchema,
    promotion: PromotionSchema.optional(),
    expectedPly: PlySchema,
  })
  .strict();

export const AiMoveRequestSchema = z
  .object({
    expectedPly: PlySchema,
  })
  .strict();

export const ResignRequestSchema = z
  .object({
    expectedPly: PlySchema,
  })
  .strict();

export const CreateGameRequestSchema = z
  .object({
    humanColor: ColorSchema.optional(),
  })
  .strict();

export const EngineScoreSchema = z
  .object({
    type: z.enum(['cp', 'mate']),
    value: z.number().int(),
  })
  .strict();

export const CandidateViewSchema = z
  .object({
    rank: z.number().int().min(1).max(5),
    uci: UciSchema,
    san: z.string().min(1),
    score: EngineScoreSchema,
    normalizedScore: z.number().int(),
  })
  .strict();

export const MoveViewSchema = z
  .object({
    id: z.string().uuid(),
    ply: z.number().int().positive(),
    color: ColorSchema,
    actor: MoveActorSchema,
    uci: UciSchema,
    san: z.string().min(1),
    fenAfter: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export const AiDecisionViewSchema = z
  .object({
    id: z.string().uuid(),
    moveId: z.string().uuid(),
    candidates: z.array(CandidateViewSchema).min(1).max(5),
    chosenUci: UciSchema,
    commentary: z.string().min(1).max(240),
    modelId: z.string().min(1),
    profileId: z.string().min(1),
    quantization: z.string().min(1),
    latencyMs: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    tokensPerSecond: z.number().nonnegative().nullable(),
    retryCount: z.union([z.literal(0), z.literal(1)]),
    createdAt: z.string().datetime(),
  })
  .strict();

export const GameViewSchema = z
  .object({
    id: z.string().uuid(),
    status: GameStatusSchema,
    humanColor: ColorSchema,
    currentFen: z.string().min(1),
    pgn: z.string(),
    result: GameResultSchema,
    modelProfileId: z.string().min(1),
    moves: z.array(MoveViewSchema),
    lastAiDecision: AiDecisionViewSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export const GameListResponseSchema = z.array(GameViewSchema);

export type Square = z.infer<typeof SquareSchema>;
export type Color = z.infer<typeof ColorSchema>;
export type GameStatus = z.infer<typeof GameStatusSchema>;
export type GameResult = z.infer<typeof GameResultSchema>;
export type MoveActor = z.infer<typeof MoveActorSchema>;
export type Promotion = z.infer<typeof PromotionSchema>;
export type Uci = z.infer<typeof UciSchema>;
export type Ply = z.infer<typeof PlySchema>;
export type SubmitMoveRequest = z.infer<typeof SubmitMoveRequestSchema>;
export type AiMoveRequest = z.infer<typeof AiMoveRequestSchema>;
export type ResignRequest = z.infer<typeof ResignRequestSchema>;
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;
export type EngineScore = z.infer<typeof EngineScoreSchema>;
export type CandidateView = z.infer<typeof CandidateViewSchema>;
export type MoveView = z.infer<typeof MoveViewSchema>;
export type AiDecisionView = z.infer<typeof AiDecisionViewSchema>;
export type GameView = z.infer<typeof GameViewSchema>;
export type GameListResponse = z.infer<typeof GameListResponseSchema>;
