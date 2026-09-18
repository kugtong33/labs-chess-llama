import { randomUUID } from 'node:crypto';

import {
  applyHumanMove,
  applyUciMove,
  legalMoves,
  reconstructGame,
  type UciMove,
} from '@chess-llama/chess-domain';
import type {
  AiMoveRequest,
  AiDecisionView,
  DecisionTraceEventInput,
  CreateGameRequest,
  GameView,
  ResignRequest,
  SubmitMoveRequest,
} from '@chess-llama/contracts';
import type {
  GameAggregate,
  GameRepository,
  SettingsRepository,
} from '@chess-llama/storage';
import type { MoveSelector } from '@chess-llama/llama-protocol';
import type { StockfishAnalyzer } from '@chess-llama/stockfish-adapter';

import { GameServiceError, StalePlyError } from './errors.js';
import { GameLock } from './game-lock.js';
import { toGameView } from './game-view.js';
import type { DecisionTraceHub } from './decision-trace-hub.js';

export interface TraceContext {
  traceId: string;
  requestId: string;
}

type TraceStage = DecisionTraceEventInput extends infer Event
  ? Event extends DecisionTraceEventInput
    ? Pick<Event, 'layer' | 'stage' | 'status' | 'summary' | 'data'>
    : never
  : never;

function traceContext(): TraceContext {
  return { traceId: randomUUID(), requestId: randomUUID() };
}

export interface GameServiceDependencies {
  games: GameRepository;
  settings: SettingsRepository;
  stockfish: StockfishAnalyzer;
  selector: MoveSelector;
  lock: GameLock;
  traceHub?: DecisionTraceHub;
}

export class GameService {
  constructor(private readonly dependencies: GameServiceDependencies) {}

  async createGame(
    input: CreateGameRequest,
    signal?: AbortSignal,
    context: TraceContext = traceContext(),
  ): Promise<GameView> {
    const settings = this.dependencies.settings.get();
    const game = this.dependencies.games.create({
      humanColor: input.humanColor ?? settings.preferredHumanColor,
      modelProfileId: settings.modelProfileId,
    });
    if (game.humanColor === 'black') {
      const result = await this.dependencies.lock.runExclusive(game.id, () =>
        this.performAiTurn(game.id, 0, signal, context),
      );
      return toGameView(result);
    }
    return toGameView(game);
  }

  listGames(): Promise<GameView[]> {
    return Promise.resolve(this.dependencies.games.list().map(toGameView));
  }

  getGame(id: string): Promise<GameView> {
    return Promise.resolve(toGameView(this.requireGame(id)));
  }

  listAiDecisions(id: string): Promise<AiDecisionView[]> {
    return Promise.resolve().then(() => {
      this.requireGame(id);
      return this.dependencies.games.listAiDecisions(id).map((decision) => ({
        ...decision,
        createdAt: new Date(decision.createdAt).toISOString(),
      }));
    });
  }

  async submitHumanMove(
    id: string,
    input: SubmitMoveRequest,
    signal?: AbortSignal,
    context: TraceContext = traceContext(),
  ): Promise<GameView> {
    return this.dependencies.lock.runExclusive(id, async () => {
      let game = this.requireGame(id);
      this.assertExpected(game, input.expectedPly);
      this.assertHumanTurn(game);
      const chess = reconstructGame(toUciMoves(game));
      let applied;
      try {
        applied = applyHumanMove(chess, input);
      } catch (error) {
        throw new GameServiceError(
          'ILLEGAL_MOVE',
          'Illegal human move',
          game.status,
          { cause: error },
        );
      }
      game = this.dependencies.games.recordHumanMove(
        id,
        {
          id: randomUUID(),
          ply: game.moves.length + 1,
          color: applied.color,
          actor: 'human',
          uci: applied.uci,
          san: applied.san,
          fenAfter: applied.fenAfter,
          pgnAfter: applied.pgnAfter,
        },
        applied.gameOver ? applied.result : undefined,
      );
      if (applied.gameOver) {
        return toGameView(game);
      }
      this.publish(context, id, game.moves.length + 1, {
        layer: 'client',
        stage: 'move_submitted',
        status: 'completed',
        summary: 'Human move accepted.',
        data: {},
      });
      const result = await this.performAiTurn(
        id,
        game.moves.length,
        signal,
        context,
      );
      return toGameView(result);
    });
  }

  async retryAiMove(
    id: string,
    input: AiMoveRequest,
    signal?: AbortSignal,
    context: TraceContext = traceContext(),
  ): Promise<GameView> {
    return this.dependencies.lock.runExclusive(id, async () => {
      const game = this.requireGame(id);
      this.assertExpected(game, input.expectedPly);
      if (game.status !== 'awaiting_ai') {
        throw new GameServiceError(
          'WRONG_TURN',
          'The game is not awaiting AI',
          game.status,
        );
      }
      return toGameView(
        await this.performAiTurn(id, game.moves.length, signal, context),
      );
    });
  }

  resignGame(
    id: string,
    expectedPly: number | ResignRequest,
  ): Promise<GameView> {
    return this.dependencies.lock.runExclusive(id, () => {
      const game = this.requireGame(id);
      const ply =
        typeof expectedPly === 'number' ? expectedPly : expectedPly.expectedPly;
      this.assertExpected(game, ply);
      if (game.status === 'completed') {
        throw new GameServiceError(
          'GAME_COMPLETED',
          'Game is completed',
          game.status,
        );
      }
      const result = game.humanColor === 'white' ? '0-1' : '1-0';
      return Promise.resolve(
        toGameView(this.dependencies.games.markCompleted(id, result)),
      );
    });
  }

  exportPgn(id: string): Promise<string> {
    return Promise.resolve(this.requireGame(id).pgn);
  }

  private requireGame(id: string): GameAggregate {
    const game = this.dependencies.games.get(id);
    if (game === null)
      throw new GameServiceError('GAME_NOT_FOUND', `Game not found: ${id}`);
    return game;
  }

  private assertExpected(game: GameAggregate, expectedPly: number): void {
    if (game.status === 'completed') {
      throw new GameServiceError(
        'GAME_COMPLETED',
        'Game is completed',
        game.status,
      );
    }
    if (expectedPly !== game.moves.length) {
      throw new StalePlyError(expectedPly, game.moves.length);
    }
  }

  private assertHumanTurn(game: GameAggregate): void {
    if (game.status !== 'active') {
      throw new GameServiceError(
        'WRONG_TURN',
        'The game is not accepting a human move',
        game.status,
      );
    }
    const turn: 'white' | 'black' =
      game.moves.length % 2 === 0 ? 'white' : 'black';
    if (turn !== game.humanColor) {
      throw new GameServiceError(
        'WRONG_TURN',
        'It is not the human turn',
        game.status,
      );
    }
  }

  private async performAiTurn(
    id: string,
    expectedPly: number,
    signal?: AbortSignal,
    context: TraceContext = traceContext(),
  ): Promise<GameAggregate> {
    let game = this.requireGame(id);
    this.assertExpected(game, expectedPly);
    if (game.status !== 'awaiting_ai') {
      throw new GameServiceError(
        'WRONG_TURN',
        'The game is not awaiting AI',
        game.status,
      );
    }
    const publish = (event: TraceStage) =>
      this.publish(context, id, expectedPly + 1, event);
    let phase: 'stockfish' | 'llama' | 'storage' | 'unknown' = 'unknown';
    try {
      const settings = this.dependencies.settings.get();
      publish({
        layer: 'gateway',
        stage: 'ai_turn_started',
        status: 'running',
        summary: 'AI turn started.',
        data: {
          fen: game.currentFen,
          sanHistory: game.moves.map((move) => move.san),
          candidateLimit: settings.stockfishCandidateLimit,
          moveTimeMs: settings.stockfishMoveTimeMs,
        },
      });
      const chess = reconstructGame(toUciMoves(game));
      const legal = legalMoves(chess);
      phase = 'stockfish';
      publish({
        layer: 'stockfish',
        stage: 'analysis_started',
        status: 'running',
        summary: 'Ranking legal moves.',
        data: {
          candidateLimit: settings.stockfishCandidateLimit,
          moveTimeMs: settings.stockfishMoveTimeMs,
        },
      });
      const candidates = await this.dependencies.stockfish.analyze({
        fen: game.currentFen,
        legalMoves: legal,
        candidateLimit: settings.stockfishCandidateLimit,
        moveTimeMs: settings.stockfishMoveTimeMs,
        maxLossCp: 150,
        signal,
      });
      const validCandidates = candidates.slice(0, 5);
      if (validCandidates.length === 0)
        throw new Error('Stockfish returned no legal candidates');
      publish({
        layer: 'stockfish',
        stage: 'analysis_completed',
        status: 'completed',
        summary: 'Legal candidates ranked.',
        data: {
          candidates: validCandidates.map(
            ({ rank, uci, san, score, normalizedScore }) => ({
              rank,
              uci,
              san,
              score: { type: score.type, value: score.value },
              normalizedScore,
            }),
          ),
        },
      });
      phase = 'llama';
      const constrainedCandidates = validCandidates.map(
        ({ rank, uci, san }) => ({ rank, uci, san }),
      );
      const selection = await this.dependencies.selector.selectMove({
        fen: game.currentFen,
        sanHistory: game.moves.map((move) => move.san),
        candidates: constrainedCandidates,
        commentaryStyle: settings.commentaryStyle,
        modelProfileId: game.modelProfileId,
        signal,
        onProgress: (event) => {
          if (event.type === 'attempt_started') {
            publish({
              layer: 'llama',
              stage: 'attempt_started',
              status: 'running',
              summary: 'Requesting a constrained model selection.',
              data: {
                attempt: event.attempt,
                profileId: game.modelProfileId,
                candidates: constrainedCandidates,
              },
            });
          } else {
            publish({
              layer: 'llama',
              stage: 'retry_scheduled',
              status: 'retrying',
              summary: 'Retrying model selection.',
              data: { attempt: event.attempt, reason: event.reason },
            });
          }
        },
      });
      if (signal?.aborted)
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const selected = validCandidates.find(
        (candidate) => candidate.uci === selection.uci,
      );
      if (selected === undefined) {
        throw new GameServiceError(
          'AI_INVALID_MOVE',
          'Model selected a move outside the legal shortlist',
          'awaiting_ai',
        );
      }
      const after = reconstructGame(toUciMoves(game));
      let applied;
      try {
        applied = applyUciMove(after, selection.uci);
      } catch (error) {
        throw new GameServiceError(
          'AI_INVALID_MOVE',
          'Model selected an illegal move',
          'awaiting_ai',
          { cause: error },
        );
      }
      publish({
        layer: 'llama',
        stage: 'selection_completed',
        status: 'completed',
        summary: 'Model selected a legal candidate.',
        data: {
          selectedMove: selection.uci,
          commentary: selection.commentary,
          modelId: selection.modelId,
          retryCount: selection.retryCount,
          latencyMs: selection.latencyMs,
          promptTokens: selection.promptTokens,
          completionTokens: selection.completionTokens,
          tokensPerSecond: selection.tokensPerSecond,
        },
      });
      phase = 'storage';
      game = this.dependencies.games.recordAiMove(
        id,
        {
          id: randomUUID(),
          ply: game.moves.length + 1,
          color: applied.color,
          actor: 'llm',
          uci: applied.uci,
          san: applied.san,
          fenAfter: applied.fenAfter,
          pgnAfter: applied.pgnAfter,
        },
        {
          candidates: validCandidates,
          chosenUci: selection.uci,
          commentary: selection.commentary,
          modelId: selection.modelId,
          profileId: game.modelProfileId,
          quantization: 'unknown',
          latencyMs: selection.latencyMs,
          promptTokens: selection.promptTokens,
          completionTokens: selection.completionTokens,
          tokensPerSecond: selection.tokensPerSecond,
          retryCount: selection.retryCount,
        },
        applied.gameOver ? applied.result : undefined,
      );
      if (game.lastAiDecision !== null) {
        publish({
          layer: 'storage',
          stage: 'decision_persisted',
          status: 'completed',
          summary: 'AI move and decision saved.',
          data: {
            decisionId: game.lastAiDecision.id,
            moveId: game.lastAiDecision.moveId,
            chosenUci: game.lastAiDecision.chosenUci,
          },
        });
      }
      publish({
        layer: 'gateway',
        stage: 'ai_turn_completed',
        status: 'completed',
        summary: 'AI turn completed.',
        data: { selectedMove: selection.uci },
      });
      return game;
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        publish({
          layer: 'client',
          stage: 'request_cancelled',
          status: 'cancelled',
          summary: 'AI request cancelled.',
          data: {},
        });
      } else {
        if (phase === 'stockfish')
          publish({
            layer: 'stockfish',
            stage: 'analysis_failed',
            status: 'failed',
            summary: 'Candidate analysis failed.',
            data: {},
          });
        if (phase === 'llama')
          publish({
            layer: 'llama',
            stage: 'selection_failed',
            status: 'failed',
            summary: 'Model selection failed.',
            data: { reason: selectionFailureReason(error) },
          });
        if (phase === 'storage')
          publish({
            layer: 'storage',
            stage: 'decision_failed',
            status: 'failed',
            summary: 'Decision persistence failed.',
            data: {},
          });
        publish({
          layer: 'gateway',
          stage: 'ai_turn_failed',
          status: 'failed',
          summary: 'AI turn failed; the game can be retried.',
          data: { reason: phase },
        });
      }
      if (error instanceof GameServiceError && error.code === 'AI_INVALID_MOVE')
        throw error;
      throw new GameServiceError(
        'AI_UNAVAILABLE',
        'AI inference is unavailable',
        'awaiting_ai',
        { cause: error },
      );
    }
  }

  private publish(
    context: TraceContext,
    gameId: string,
    ply: number,
    event: TraceStage,
  ): void {
    try {
      this.dependencies.traceHub?.publish({
        schemaVersion: 1,
        ...context,
        gameId,
        ply,
        ...event,
      });
    } catch {
      // Observability must never change the result of a move.
    }
  }
}

function selectionFailureReason(
  error: unknown,
): 'timeout' | 'http' | 'invalid_completion' | 'transport' {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'timeout';
    if (error.name === 'HttpError') return 'http';
    if (
      error.name === 'InvalidCompletionError' ||
      (error instanceof GameServiceError && error.code === 'AI_INVALID_MOVE')
    )
      return 'invalid_completion';
  }
  return 'transport';
}

function toUciMoves(game: GameAggregate): UciMove[] {
  return game.moves.map((move) => ({ uci: move.uci }));
}
