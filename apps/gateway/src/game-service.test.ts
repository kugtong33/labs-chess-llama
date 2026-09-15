import { describe, expect, it } from 'vitest';

import type { Color, GameResult, Settings } from '@chess-llama/contracts';
import type {
  GameAggregate,
  GameRepository,
  PersistableAiDecision,
  PersistableMove,
  SettingsRepository,
  StoredAiDecision,
} from '@chess-llama/storage';
import type {
  AnalysisRequest,
  RankedCandidate,
  StockfishAnalyzer,
} from '@chess-llama/stockfish-adapter';
import type {
  ModelHealth,
  MoveSelection,
  MoveSelector,
  SelectMoveRequest,
} from '@chess-llama/llama-protocol';

import { GameLock } from './game-lock.js';
import { GameService } from './game-service.js';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

class MemoryGames implements GameRepository {
  readonly records = new Map<string, GameAggregate>();
  private sequence = 0;
  constructor(private readonly events: string[] = []) {}

  create(input: { humanColor: Color; modelProfileId: string }): GameAggregate {
    const id = `game-${++this.sequence}`;
    const now = Date.now();
    const game: GameAggregate = {
      id,
      status: input.humanColor === 'white' ? 'active' : 'awaiting_ai',
      humanColor: input.humanColor,
      currentFen: INITIAL_FEN,
      pgn: '',
      result: '*',
      modelProfileId: input.modelProfileId,
      moves: [],
      lastAiDecision: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.records.set(id, game);
    return this.copy(game);
  }

  get(id: string): GameAggregate | null {
    const game = this.records.get(id);
    return game === undefined ? null : this.copy(game);
  }

  getRequired(id: string): GameAggregate {
    const game = this.get(id);
    if (game === null) throw new Error(`Game not found: ${id}`);
    return game;
  }

  list(): GameAggregate[] {
    return [...this.records.values()].map((game) => this.copy(game));
  }

  recordHumanMove(gameId: string, move: PersistableMove): GameAggregate {
    this.events.push(`record-human:${move.uci}`);
    const game = this.getRequired(gameId);
    game.moves.push({
      ...move,
      pgnAfter: move.pgnAfter,
      createdAt: move.createdAt ?? Date.now(),
    });
    game.currentFen = move.fenAfter;
    game.pgn = move.pgnAfter;
    game.status = 'awaiting_ai';
    game.updatedAt = Date.now();
    game.result = '*';
    this.records.set(gameId, game);
    return this.copy(game);
  }

  recordAiMove(
    gameId: string,
    move: PersistableMove,
    decision: PersistableAiDecision,
  ): GameAggregate {
    this.events.push(`record-ai:${move.uci}`);
    const game = this.getRequired(gameId);
    const storedDecision: StoredAiDecision = {
      id: decision.id ?? `decision-${game.moves.length + 1}`,
      moveId: move.id,
      candidates: decision.candidates,
      chosenUci: decision.chosenUci,
      commentary: decision.commentary,
      modelId: decision.modelId,
      profileId: decision.profileId,
      quantization: decision.quantization,
      latencyMs: decision.latencyMs,
      promptTokens: decision.promptTokens,
      completionTokens: decision.completionTokens,
      tokensPerSecond: decision.tokensPerSecond,
      retryCount: decision.retryCount,
      createdAt: decision.createdAt ?? Date.now(),
    };
    game.moves.push({
      ...move,
      pgnAfter: move.pgnAfter,
      createdAt: move.createdAt ?? Date.now(),
    });
    game.currentFen = move.fenAfter;
    game.pgn = move.pgnAfter;
    game.status = 'active';
    game.updatedAt = Date.now();
    game.result = '*';
    game.lastAiDecision = storedDecision;
    this.records.set(gameId, game);
    return this.copy(game);
  }

  markCompleted(gameId: string, result: GameResult): GameAggregate {
    const game = this.getRequired(gameId);
    game.status = 'completed';
    game.result = result;
    game.completedAt = Date.now();
    game.updatedAt = Date.now();
    this.records.set(gameId, game);
    return this.copy(game);
  }

  private copy(game: GameAggregate): GameAggregate {
    return structuredClone(game);
  }
}

const settings: Settings = {
  preferredHumanColor: 'white',
  boardOrientation: 'white',
  theme: 'system',
  commentaryStyle: 'concise',
  modelProfileId: 'default-profile',
  stockfishCandidateLimit: 2,
  stockfishMoveTimeMs: 100,
};

class MemorySettings implements SettingsRepository {
  get(): Settings {
    return settings;
  }
  update(patch: Partial<Settings>): Settings {
    return { ...settings, ...patch };
  }
}

class FakeStockfish implements StockfishAnalyzer {
  events: string[];
  release: (() => void) | undefined;
  constructor(
    private readonly candidates: RankedCandidate[],
    events: string[],
  ) {
    this.events = events;
  }
  async analyze(_request: AnalysisRequest): Promise<RankedCandidate[]> {
    this.events.push('analyze-stockfish');
    if (this.release !== undefined)
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    if (_request.legalMoves.some((move) => move.uci === 'e2e4')) {
      return [
        {
          rank: 1,
          uci: 'e2e4',
          san: 'e4',
          score: { type: 'cp', value: 20 },
          normalizedScore: 20,
        },
        {
          rank: 2,
          uci: 'c2c4',
          san: 'c4',
          score: { type: 'cp', value: 10 },
          normalizedScore: 10,
        },
      ];
    }
    return this.candidates;
  }
  async close(): Promise<void> {}
}

class FakeSelector implements MoveSelector {
  events: string[];
  error: Error | undefined;
  selectedUci: string;
  gate: Promise<void> | undefined;
  constructor(events: string[], selectedUci: string) {
    this.events = events;
    this.selectedUci = selectedUci;
  }
  health(): Promise<ModelHealth> {
    return Promise.resolve({
      status: 'ready',
      modelId: 'test-model',
      profileId: 'default-profile',
      quantization: 'q4',
      backend: 'test',
    });
  }
  async selectMove(request: SelectMoveRequest): Promise<MoveSelection> {
    this.events.push(
      `select-llama:${request.candidates.map((candidate) => candidate.uci).join(',')}`,
    );
    if (this.gate !== undefined) await this.gate;
    if (this.error !== undefined) throw this.error;
    return {
      uci: this.selectedUci,
      commentary: 'A sound developing move.',
      modelId: 'test-model',
      latencyMs: 2,
      promptTokens: 10,
      completionTokens: 4,
      tokensPerSecond: 20,
      retryCount: 0,
    };
  }
}

function createServiceHarness(
  options: { selectedUci?: string; selectError?: Error } = {},
) {
  const events: string[] = [];
  const games = new MemoryGames(events);
  const stockfish = new FakeStockfish(
    [
      {
        rank: 1,
        uci: 'e7e5',
        san: 'e5',
        score: { type: 'cp', value: 20 },
        normalizedScore: 20,
      },
      {
        rank: 2,
        uci: 'c7c5',
        san: 'c5',
        score: { type: 'cp', value: 10 },
        normalizedScore: 10,
      },
    ],
    events,
  );
  const selector = new FakeSelector(events, options.selectedUci ?? 'e7e5');
  selector.error = options.selectError;
  return {
    events,
    games,
    stockfish,
    selector,
    service: new GameService({
      games,
      settings: new MemorySettings(),
      stockfish,
      selector,
      lock: new GameLock(),
    }),
  };
}

describe('GameService', () => {
  it('persists the human move before selecting and then records the LLM move', async () => {
    const harness = createServiceHarness({ selectedUci: 'e7e5' });
    const game = await harness.service.createGame({ humanColor: 'white' });
    const updated = await harness.service.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    expect(harness.events).toEqual([
      'record-human:e2e4',
      'analyze-stockfish',
      'select-llama:e7e5,c7c5',
      'record-ai:e7e5',
    ]);
    expect(updated.moves.map((move) => move.uci)).toEqual(['e2e4', 'e7e5']);
  });

  it('leaves a resumable awaiting_ai game when inference fails', async () => {
    const harness = createServiceHarness({
      selectError: new Error('model offline'),
    });
    const game = await harness.service.createGame({ humanColor: 'white' });
    await expect(
      harness.service.submitHumanMove(game.id, {
        from: 'e2',
        to: 'e4',
        expectedPly: 0,
      }),
    ).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      gameStatus: 'awaiting_ai',
    });
    expect(harness.games.getRequired(game.id).status).toBe('awaiting_ai');
  });

  it('rejects stale ply before mutating the game', async () => {
    const harness = createServiceHarness();
    const game = await harness.service.createGame({ humanColor: 'white' });
    await expect(
      harness.service.submitHumanMove(game.id, {
        from: 'e2',
        to: 'e4',
        expectedPly: 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_PLY' });
    expect(harness.games.getRequired(game.id).moves).toHaveLength(0);
  });

  it('rejects illegal human moves without calling external engines', async () => {
    const harness = createServiceHarness();
    const game = await harness.service.createGame({ humanColor: 'white' });
    await expect(
      harness.service.submitHumanMove(game.id, {
        from: 'e2',
        to: 'e5',
        expectedPly: 0,
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    expect(harness.events).toEqual([]);
  });

  it('calls the model for a black human opening turn', async () => {
    const harness = createServiceHarness({ selectedUci: 'e2e4' });
    const game = await harness.service.createGame({ humanColor: 'black' });
    expect(game.moves.map((move) => move.uci)).toEqual(['e2e4']);
    expect(game.status).toBe('active');
    expect(harness.events).toContain('select-llama:e2e4,c2c4');
  });

  it('rejects an invalid model choice and keeps retry state', async () => {
    const harness = createServiceHarness({ selectedUci: 'a7a6' });
    const game = await harness.service.createGame({ humanColor: 'white' });
    await expect(
      harness.service.submitHumanMove(game.id, {
        from: 'e2',
        to: 'e4',
        expectedPly: 0,
      }),
    ).rejects.toMatchObject({
      code: 'AI_INVALID_MOVE',
      gameStatus: 'awaiting_ai',
    });
    expect(harness.games.getRequired(game.id).status).toBe('awaiting_ai');
  });

  it('rechecks the ply after serializing duplicate concurrent requests', async () => {
    const harness = createServiceHarness();
    const game = await harness.service.createGame({ humanColor: 'white' });
    let release!: () => void;
    harness.selector.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = harness.service.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = harness.service.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    release();
    await first;
    await expect(second).rejects.toMatchObject({ code: 'STALE_PLY' });
    expect(harness.games.getRequired(game.id).moves).toHaveLength(2);
  });

  it('retries an awaiting AI turn with the current ply', async () => {
    const harness = createServiceHarness({ selectError: new Error('offline') });
    const game = await harness.service.createGame({ humanColor: 'white' });
    await expect(
      harness.service.submitHumanMove(game.id, {
        from: 'e2',
        to: 'e4',
        expectedPly: 0,
      }),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    harness.selector.error = undefined;
    const retried = await harness.service.retryAiMove(game.id, {
      expectedPly: 1,
    });
    expect(retried.moves.map((move) => move.uci)).toEqual(['e2e4', 'e7e5']);
  });

  it('does not mutate completed games', async () => {
    const harness = createServiceHarness();
    const game = await harness.service.createGame({ humanColor: 'white' });
    harness.games.markCompleted(game.id, '1-0');
    await expect(
      harness.service.submitHumanMove(game.id, {
        from: 'e2',
        to: 'e4',
        expectedPly: 0,
      }),
    ).rejects.toMatchObject({ code: 'GAME_COMPLETED' });
  });

  it('reports a cancelled AI operation as recoverable and releases its lock', async () => {
    const harness = createServiceHarness({
      selectError: new DOMException('cancelled', 'AbortError'),
    });
    const game = await harness.service.createGame({ humanColor: 'white' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      harness.service.submitHumanMove(
        game.id,
        { from: 'e2', to: 'e4', expectedPly: 0 },
        controller.signal,
      ),
    ).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      gameStatus: 'awaiting_ai',
    });
    expect(harness.games.getRequired(game.id).status).toBe('awaiting_ai');
  });
});
