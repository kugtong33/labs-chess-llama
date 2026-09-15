import { randomUUID } from 'node:crypto';

import {
  AiDecisionViewSchema,
  CandidateViewSchema,
  ColorSchema,
  GameResultSchema,
  GameStatusSchema,
  MoveActorSchema,
  UciSchema,
  type Color,
  type GameResult,
} from '@chess-llama/contracts';

import type { SqliteDatabase } from './database.js';
import type {
  GameAggregate,
  PersistableAiDecision,
  PersistableMove,
  StoredAiDecision,
  StoredMove,
} from './types.js';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface GameRepository {
  create(input: { humanColor: Color; modelProfileId: string }): GameAggregate;
  get(id: string): GameAggregate | null;
  getRequired(id: string): GameAggregate;
  list(): GameAggregate[];
  recordHumanMove(gameId: string, move: PersistableMove): GameAggregate;
  recordAiMove(
    gameId: string,
    move: PersistableMove,
    decision: PersistableAiDecision,
  ): GameAggregate;
  markCompleted(gameId: string, result: GameResult): GameAggregate;
}

interface GameRow {
  id: string;
  status: string;
  human_color: string;
  current_fen: string;
  pgn: string;
  result: string;
  model_profile_id: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface MoveRow {
  id: string;
  ply: number;
  color: string;
  actor: string;
  uci: string;
  san: string;
  fen_after: string;
  created_at: number;
}

interface DecisionRow {
  id: string;
  move_id: string;
  candidates_json: string;
  chosen_uci: string;
  commentary: string;
  model_id: string;
  profile_id: string;
  quantization: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  tokens_per_second: number | null;
  retry_count: number;
  created_at: number;
}

export function createGameRepository(db: SqliteDatabase): GameRepository {
  const getRow = (id: string): GameRow | undefined =>
    db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      GameRow | undefined;

  const getRequiredRow = (id: string): GameRow => {
    const row = getRow(id);
    if (row === undefined) throw new Error(`Game not found: ${id}`);
    return row;
  };

  const readAggregate = (row: GameRow): GameAggregate => {
    const moveRows = db
      .prepare('SELECT * FROM moves WHERE game_id = ? ORDER BY ply')
      .all(row.id) as MoveRow[];
    const decisionRow = db
      .prepare(
        `SELECT ai.*
         FROM ai_decisions ai
         JOIN moves m ON m.id = ai.move_id
         WHERE ai.game_id = ?
         ORDER BY m.ply DESC, ai.id DESC
         LIMIT 1`,
      )
      .get(row.id) as DecisionRow | undefined;

    return {
      id: row.id,
      status: GameStatusSchema.parse(row.status),
      humanColor: ColorSchema.parse(row.human_color),
      currentFen: row.current_fen,
      pgn: row.pgn,
      result: GameResultSchema.parse(row.result),
      modelProfileId: row.model_profile_id,
      moves: moveRows.map(readMove),
      lastAiDecision:
        decisionRow === undefined ? null : readDecision(decisionRow),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  };

  const transaction = db.transaction((operation: () => GameAggregate) =>
    operation(),
  );

  return {
    create(input) {
      const now = Date.now();
      const id = randomUUID();
      const status = input.humanColor === 'white' ? 'active' : 'awaiting_ai';
      db.prepare(
        `INSERT INTO games
          (id, status, human_color, current_fen, pgn, result, model_profile_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, '', '*', ?, ?, ?, NULL)`,
      ).run(
        id,
        status,
        input.humanColor,
        INITIAL_FEN,
        input.modelProfileId,
        now,
        now,
      );
      return readAggregate(getRequiredRow(id));
    },

    get(id) {
      const row = getRow(id);
      return row === undefined ? null : readAggregate(row);
    },

    getRequired(id) {
      return readAggregate(getRequiredRow(id));
    },

    list() {
      return (
        db
          .prepare('SELECT * FROM games ORDER BY updated_at DESC')
          .all() as GameRow[]
      ).map(readAggregate);
    },

    recordHumanMove(gameId, move) {
      validateMove(move, 'human');
      return transaction(() => {
        const game = getRequiredRow(gameId);
        ensureOpen(game);
        const now = move.createdAt ?? Date.now();
        insertMove(gameId, move, now);
        db.prepare(
          `UPDATE games
           SET current_fen = ?, pgn = ?, status = 'awaiting_ai', result = '*',
               updated_at = ?, completed_at = NULL
           WHERE id = ?`,
        ).run(move.fenAfter, move.pgnAfter, now, gameId);
        return readAggregate(getRequiredRow(gameId));
      });
    },

    recordAiMove(gameId, move, decision) {
      validateMove(move, 'llm');
      const validatedDecision = validateDecision(decision, move.id);
      return transaction(() => {
        const game = getRequiredRow(gameId);
        ensureOpen(game);
        const now = move.createdAt ?? decision.createdAt ?? Date.now();
        insertMove(gameId, move, now);
        db.prepare(
          `INSERT INTO ai_decisions
            (id, game_id, move_id, candidates_json, chosen_uci, commentary,
             model_id, profile_id, quantization, latency_ms, prompt_tokens,
             completion_tokens, tokens_per_second, retry_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          validatedDecision.id,
          gameId,
          move.id,
          JSON.stringify(validatedDecision.candidates),
          validatedDecision.chosenUci,
          validatedDecision.commentary,
          validatedDecision.modelId,
          validatedDecision.profileId,
          validatedDecision.quantization,
          validatedDecision.latencyMs,
          validatedDecision.promptTokens,
          validatedDecision.completionTokens,
          validatedDecision.tokensPerSecond,
          validatedDecision.retryCount,
          now,
        );
        db.prepare(
          `UPDATE games
           SET current_fen = ?, pgn = ?, status = 'active', result = '*',
               updated_at = ?, completed_at = NULL
           WHERE id = ?`,
        ).run(move.fenAfter, move.pgnAfter, now, gameId);
        return readAggregate(getRequiredRow(gameId));
      });
    },

    markCompleted(gameId, result) {
      const validatedResult = GameResultSchema.parse(result);
      return transaction(() => {
        getRequiredRow(gameId);
        const now = Date.now();
        db.prepare(
          `UPDATE games
           SET status = 'completed', result = ?, updated_at = ?, completed_at = ?
           WHERE id = ?`,
        ).run(validatedResult, now, now, gameId);
        return readAggregate(getRequiredRow(gameId));
      });
    },
  };

  function insertMove(
    gameId: string,
    move: PersistableMove,
    createdAt: number,
  ) {
    db.prepare(
      `INSERT INTO moves
        (id, game_id, ply, color, actor, uci, san, fen_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      move.id,
      gameId,
      move.ply,
      move.color,
      move.actor,
      move.uci,
      move.san,
      move.fenAfter,
      createdAt,
    );
  }
}

function ensureOpen(game: GameRow): void {
  if (game.status === 'completed') {
    throw new Error(`Game is completed: ${game.id}`);
  }
}

function validateMove(move: PersistableMove, actor: 'human' | 'llm'): void {
  if (move.actor !== actor) throw new Error(`Expected ${actor} move`);
  if (move.ply < 1 || !Number.isInteger(move.ply)) {
    throw new Error('Move ply must be a positive integer');
  }
  ColorSchema.parse(move.color);
  MoveActorSchema.parse(move.actor);
  UciSchema.parse(move.uci);
  if (move.san.length === 0 || move.fenAfter.length === 0) {
    throw new Error('Move notation and FEN are required');
  }
}

function validateDecision(
  decision: PersistableAiDecision,
  moveId: string,
): PersistableAiDecision & { id: string; moveId: string } {
  if (decision.moveId !== undefined && decision.moveId !== moveId) {
    throw new Error('Decision move ID mismatch');
  }
  const normalized = {
    ...decision,
    id: decision.id ?? randomUUID(),
    moveId,
  };
  const withoutCreatedAt = { ...normalized };
  delete withoutCreatedAt.createdAt;
  AiDecisionViewSchema.omit({ createdAt: true }).parse(withoutCreatedAt);
  return normalized;
}

function readMove(row: MoveRow): StoredMove {
  return {
    id: row.id,
    ply: row.ply,
    color: ColorSchema.parse(row.color),
    actor: MoveActorSchema.parse(row.actor),
    uci: UciSchema.parse(row.uci),
    san: row.san,
    fenAfter: row.fen_after,
    createdAt: row.created_at,
  };
}

function readDecision(row: DecisionRow): StoredAiDecision {
  const parsed = AiDecisionViewSchema.omit({ createdAt: true }).parse({
    id: row.id,
    moveId: row.move_id,
    candidates: CandidateViewSchema.array().parse(
      JSON.parse(row.candidates_json),
    ),
    chosenUci: UciSchema.parse(row.chosen_uci),
    commentary: row.commentary,
    modelId: row.model_id,
    profileId: row.profile_id,
    quantization: row.quantization,
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    tokensPerSecond: row.tokens_per_second,
    retryCount: row.retry_count,
  });
  return { ...parsed, createdAt: row.created_at };
}
