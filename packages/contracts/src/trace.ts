import { z } from 'zod';
import {
  AiDecisionViewSchema,
  CandidateViewSchema,
  UciSchema,
} from './game.js';

export const DecisionTraceLayerSchema = z.enum([
  'client',
  'gateway',
  'stockfish',
  'llama',
  'storage',
]);

const TraceEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  traceId: z.string().uuid(),
  requestId: z.string().min(1),
  gameId: z.string().uuid().nullable(),
  ply: z.number().int().positive().nullable(),
  summary: z.string().min(1).max(240),
});

const traceVariant = <
  Layer extends z.ZodLiteral<string>,
  Stage extends z.ZodLiteral<string>,
  Status extends z.ZodLiteral<string>,
  Data extends z.ZodObject,
>(
  layer: Layer,
  stage: Stage,
  status: Status,
  data: Data,
) =>
  TraceEnvelopeSchema.extend({ layer, stage, status, data })
    .strict()
    .describe('Curated decision trace event');

const EmptyDataSchema = z.object({}).strict();
const RetryReasonSchema = z.enum([
  'timeout',
  'http',
  'invalid_completion',
  'transport',
]);

export const DecisionTraceEventSchema = z.discriminatedUnion('stage', [
  traceVariant(
    z.literal('client'),
    z.literal('move_submitted'),
    z.literal('completed'),
    z.object({}).strict(),
  ),
  traceVariant(
    z.literal('client'),
    z.literal('request_cancelled'),
    z.literal('cancelled'),
    EmptyDataSchema,
  ),
  traceVariant(
    z.literal('gateway'),
    z.literal('ai_turn_started'),
    z.literal('running'),
    z
      .object({
        fen: z.string().min(1),
        sanHistory: z.array(z.string().min(1)),
        candidateLimit: z.number().int().positive(),
        moveTimeMs: z.number().int().positive(),
      })
      .strict(),
  ),
  traceVariant(
    z.literal('gateway'),
    z.literal('ai_turn_completed'),
    z.literal('completed'),
    z
      .object({
        selectedMove: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
      })
      .strict(),
  ),
  traceVariant(
    z.literal('gateway'),
    z.literal('ai_turn_failed'),
    z.literal('failed'),
    z
      .object({ reason: z.enum(['stockfish', 'llama', 'storage', 'unknown']) })
      .strict(),
  ),
  traceVariant(
    z.literal('stockfish'),
    z.literal('analysis_started'),
    z.literal('running'),
    z
      .object({
        candidateLimit: z.number().int().positive(),
        moveTimeMs: z.number().int().positive(),
      })
      .strict(),
  ),
  traceVariant(
    z.literal('stockfish'),
    z.literal('analysis_completed'),
    z.literal('completed'),
    z
      .object({ candidates: z.array(CandidateViewSchema).min(1).max(5) })
      .strict(),
  ),
  traceVariant(
    z.literal('stockfish'),
    z.literal('analysis_failed'),
    z.literal('failed'),
    EmptyDataSchema,
  ),
  traceVariant(
    z.literal('llama'),
    z.literal('attempt_started'),
    z.literal('running'),
    z
      .object({
        attempt: z.union([z.literal(0), z.literal(1)]),
        profileId: z.string().min(1),
        candidates: z
          .array(CandidateViewSchema.pick({ rank: true, uci: true, san: true }))
          .min(1)
          .max(5),
      })
      .strict(),
  ),
  traceVariant(
    z.literal('llama'),
    z.literal('retry_scheduled'),
    z.literal('retrying'),
    z.object({ attempt: z.literal(1), reason: RetryReasonSchema }).strict(),
  ),
  traceVariant(
    z.literal('llama'),
    z.literal('selection_completed'),
    z.literal('completed'),
    z
      .object({
        selectedMove: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
        retryCount: z.union([z.literal(0), z.literal(1)]),
        commentary: AiDecisionViewSchema.shape.commentary,
        modelId: AiDecisionViewSchema.shape.modelId,
        latencyMs: AiDecisionViewSchema.shape.latencyMs,
        promptTokens: AiDecisionViewSchema.shape.promptTokens,
        completionTokens: AiDecisionViewSchema.shape.completionTokens,
        tokensPerSecond: AiDecisionViewSchema.shape.tokensPerSecond,
      })
      .strict(),
  ),
  traceVariant(
    z.literal('llama'),
    z.literal('selection_failed'),
    z.literal('failed'),
    z.object({ reason: RetryReasonSchema }).strict(),
  ),
  traceVariant(
    z.literal('storage'),
    z.literal('decision_persisted'),
    z.literal('completed'),
    z
      .object({
        decisionId: z.string().uuid(),
        moveId: z.string().uuid(),
        chosenUci: UciSchema,
      })
      .strict(),
  ),
  traceVariant(
    z.literal('storage'),
    z.literal('decision_failed'),
    z.literal('failed'),
    EmptyDataSchema,
  ),
]);

export type DecisionTraceLayer = z.infer<typeof DecisionTraceLayerSchema>;
export type DecisionTraceEvent = z.infer<typeof DecisionTraceEventSchema>;
export type DecisionTraceEventInput = DecisionTraceEvent extends infer Event
  ? Event extends DecisionTraceEvent
    ? Omit<Event, 'id' | 'sequence' | 'timestamp'>
    : never
  : never;

export interface DecisionTraceFilter {
  layer?: DecisionTraceLayer;
  gameId?: string;
}
