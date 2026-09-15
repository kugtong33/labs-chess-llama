import {
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  humanColor: text('human_color').notNull(),
  currentFen: text('current_fen').notNull(),
  pgn: text('pgn').notNull().default(''),
  result: text('result').notNull().default('*'),
  modelProfileId: text('model_profile_id').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
});

export const moves = sqliteTable(
  'moves',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull(),
    ply: integer('ply').notNull(),
    color: text('color').notNull(),
    actor: text('actor').notNull(),
    uci: text('uci').notNull(),
    san: text('san').notNull(),
    fenAfter: text('fen_after').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    gamePly: unique('moves_game_ply_unique').on(table.gameId, table.ply),
  }),
);

export const aiDecisions = sqliteTable('ai_decisions', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  moveId: text('move_id').notNull().unique(),
  candidatesJson: text('candidates_json').notNull(),
  chosenUci: text('chosen_uci').notNull(),
  commentary: text('commentary').notNull(),
  modelId: text('model_id').notNull(),
  profileId: text('profile_id').notNull(),
  quantization: text('quantization').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  tokensPerSecond: real('tokens_per_second'),
  retryCount: integer('retry_count').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  preferredHumanColor: text('preferred_human_color').notNull(),
  boardOrientation: text('board_orientation').notNull(),
  theme: text('theme').notNull(),
  commentaryStyle: text('commentary_style').notNull(),
  modelProfileId: text('model_profile_id').notNull(),
  stockfishCandidateLimit: integer('stockfish_candidate_limit').notNull(),
  stockfishMoveTimeMs: integer('stockfish_move_time_ms').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
