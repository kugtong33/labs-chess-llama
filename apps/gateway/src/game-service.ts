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

export interface GameServiceDependencies {
  games: GameRepository;
  settings: SettingsRepository;
  stockfish: StockfishAnalyzer;
  selector: MoveSelector;
  lock: GameLock;
}

export class GameService {
  constructor(private readonly dependencies: GameServiceDependencies) {}

  async createGame(
    input: CreateGameRequest,
    signal?: AbortSignal,
  ): Promise<GameView> {
    const settings = this.dependencies.settings.get();
    const game = this.dependencies.games.create({
      humanColor: input.humanColor ?? settings.preferredHumanColor,
      modelProfileId: settings.modelProfileId,
    });
    if (game.humanColor === 'black') {
      const result = await this.dependencies.lock.runExclusive(game.id, () =>
        this.performAiTurn(game.id, 0, signal),
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

  async submitHumanMove(
    id: string,
    input: SubmitMoveRequest,
    signal?: AbortSignal,
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
      const result = await this.performAiTurn(id, game.moves.length, signal);
      return toGameView(result);
    });
  }

  async retryAiMove(
    id: string,
    input: AiMoveRequest,
    signal?: AbortSignal,
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
        await this.performAiTurn(id, game.moves.length, signal),
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
    try {
      const settings = this.dependencies.settings.get();
      const chess = reconstructGame(toUciMoves(game));
      const legal = legalMoves(chess);
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
      const selection = await this.dependencies.selector.selectMove({
        fen: game.currentFen,
        sanHistory: game.moves.map((move) => move.san),
        candidates: validCandidates.map((candidate) => ({
          rank: candidate.rank,
          uci: candidate.uci,
          san: candidate.san,
        })),
        commentaryStyle: settings.commentaryStyle,
        modelProfileId: game.modelProfileId,
        signal,
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
      return game;
    } catch (error) {
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
}

function toUciMoves(game: GameAggregate): UciMove[] {
  return game.moves.map((move) => ({ uci: move.uci }));
}
