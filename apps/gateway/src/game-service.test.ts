import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

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
  SelectMoveProgressEvent,
} from '@chess-llama/llama-protocol';

import { GameLock } from './game-lock.js';
import { GameService } from './game-service.js';
import { DecisionTraceHub } from './decision-trace-hub.js';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

class MemoryGames implements GameRepository {
  readonly records = new Map<string, GameAggregate>();
  constructor(private readonly events: string[] = []) {}

  create(input: { humanColor: Color; modelProfileId: string }): GameAggregate {
    const id = randomUUID();
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

  listAiDecisions(id: string): StoredAiDecision[] {
    const decision = this.getRequired(id).lastAiDecision;
    return decision === null ? [] : [decision];
  }

  recordHumanMove(
    gameId: string,
    move: PersistableMove,
    result?: GameResult,
  ): GameAggregate {
    this.events.push(`record-human:${move.uci}`);
    const game = this.getRequired(gameId);
    game.moves.push({
      ...move,
      pgnAfter: move.pgnAfter,
      createdAt: move.createdAt ?? Date.now(),
    });
    game.currentFen = move.fenAfter;
    game.pgn = move.pgnAfter;
    game.status = result === undefined ? 'awaiting_ai' : 'completed';
    game.updatedAt = Date.now();
    game.result = result ?? '*';
    game.completedAt = result === undefined ? null : Date.now();
    if (result !== undefined) game.pgn = `${move.pgnAfter} ${result}`;
    this.records.set(gameId, game);
    return this.copy(game);
  }

  recordAiMove(
    gameId: string,
    move: PersistableMove,
    decision: PersistableAiDecision,
    result?: GameResult,
  ): GameAggregate {
    this.events.push(`record-ai:${move.uci}`);
    const game = this.getRequired(gameId);
    const storedDecision: StoredAiDecision = {
      id: decision.id ?? randomUUID(),
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
    game.status = result === undefined ? 'active' : 'completed';
    game.updatedAt = Date.now();
    game.result = result ?? '*';
    game.completedAt = result === undefined ? null : Date.now();
    if (result !== undefined) game.pgn = `${move.pgnAfter} ${result}`;
    game.lastAiDecision = storedDecision;
    this.records.set(gameId, game);
    return this.copy(game);
  }

  markCompleted(gameId: string, result: GameResult): GameAggregate {
    const game = this.getRequired(gameId);
    game.status = 'completed';
    game.result = result;
    game.pgn = game.pgn.replace(/(?:1-0|0-1|1\/2-1\/2|\*)\s*$/, '').trim();
    game.pgn = game.pgn.length === 0 ? result : `${game.pgn} ${result}`;
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
  retry = false;
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
    notifyProgress(request, { type: 'attempt_started', attempt: 0 });
    if (this.retry) {
      notifyProgress(request, {
        type: 'retry_scheduled',
        attempt: 1,
        reason: 'timeout',
      });
      notifyProgress(request, { type: 'attempt_started', attempt: 1 });
    }
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
      retryCount: this.retry ? 1 : 0,
    };
  }
}

function notifyProgress(
  request: SelectMoveRequest,
  event: SelectMoveProgressEvent,
): void {
  try {
    void Promise.resolve(request.onProgress?.(event)).catch(() => undefined);
  } catch {
    // Test doubles preserve production's diagnostic-only observer behavior.
  }
}

function createServiceHarness(
  options: {
    selectedUci?: string;
    selectError?: Error;
    candidateUcis?: string[];
  } = {},
) {
  const events: string[] = [];
  const games = new MemoryGames(events);
  const stockfish = new FakeStockfish(
    options.candidateUcis?.map((uci, index) => ({
      rank: index + 1,
      uci,
      san: uci,
      score: { type: 'cp' as const, value: 20 - index * 10 },
      normalizedScore: 20 - index * 10,
    })) ?? [
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
  const traceHub = new DecisionTraceHub();
  return {
    traceHub,
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
      traceHub,
    }),
  };
}

describe('GameService', () => {
  it('finishes immediate move orchestration before invoking trace observers', async () => {
    const { service, traceHub } = createServiceHarness();
    const game = await service.createGame({ humanColor: 'white' });
    const order: string[] = [];
    let complete!: () => void;
    const delivered = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const unsubscribe = traceHub.subscribe({}, (event) => {
      order.push(event.stage);
      if (event.stage === 'ai_turn_completed') complete();
    });
    const moved = await service.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    order.push('move returned');
    expect(moved.moves.map((move) => move.uci)).toEqual(['e2e4', 'e7e5']);
    expect(order).toEqual(['move returned']);
    await delivered;
    expect(order.at(-1)).toBe('ai_turn_completed');
    unsubscribe();
  });
  it('exposes stored decision history with public dates and missing-game errors', async () => {
    const { service } = createServiceHarness();
    const game = await service.createGame({ humanColor: 'white' });
    expect(await service.listAiDecisions(game.id)).toEqual([]);
    const moved = await service.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    expect(await service.listAiDecisions(game.id)).toEqual([
      moved.lastAiDecision,
    ]);
    await expect(service.listAiDecisions(randomUUID())).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
  });
  it('publishes the five-layer success sequence with curated evidence and correlation', async () => {
    const { service, traceHub } = createServiceHarness();
    const context = { traceId: randomUUID(), requestId: 'req-test' };
    const game = await service.createGame({ humanColor: 'white' });
    const moved = await service.submitHumanMove(
      game.id,
      { from: 'e2', to: 'e4', expectedPly: 0 },
      undefined,
      context,
    );
    const events = traceHub.snapshot({});
    expect(events.map((event) => `${event.layer}.${event.stage}`)).toEqual([
      'client.move_submitted',
      'gateway.ai_turn_started',
      'stockfish.analysis_started',
      'stockfish.analysis_completed',
      'llama.attempt_started',
      'llama.selection_completed',
      'storage.decision_persisted',
      'gateway.ai_turn_completed',
    ]);
    expect(
      events.every(
        (event) =>
          event.traceId === context.traceId &&
          event.requestId === 'req-test' &&
          event.gameId === game.id &&
          event.ply === 2,
      ),
    ).toBe(true);
    expect(events[1]?.data).toEqual({
      fen: moved.moves[0]?.fenAfter,
      sanHistory: ['e4'],
      candidateLimit: 2,
      moveTimeMs: 100,
    });
    expect(events[3]?.data).toEqual({
      candidates: moved.lastAiDecision?.candidates,
    });
    expect(events[4]?.data).toEqual({
      attempt: 0,
      profileId: 'default-profile',
      candidates: [
        { rank: 1, uci: 'e7e5', san: 'e5' },
        { rank: 2, uci: 'c7c5', san: 'c5' },
      ],
    });
    expect(events[5]?.data).toEqual({
      selectedMove: 'e7e5',
      commentary: 'A sound developing move.',
      modelId: 'test-model',
      retryCount: 0,
      latencyMs: 2,
      promptTokens: 10,
      completionTokens: 4,
      tokensPerSecond: 20,
    });
    expect(events[6]?.data).toEqual({
      decisionId: moved.lastAiDecision?.id,
      moveId: moved.lastAiDecision?.moveId,
      chosenUci: 'e7e5',
    });
  });

  it('publishes retries before the second attempt and survives failed observers', async () => {
    const { service, selector, traceHub } = createServiceHarness();
    selector.retry = true;
    traceHub.subscribe({}, () => {
      throw new Error('disconnected');
    });
    const game = await service.createGame({ humanColor: 'white' });
    const moved = await service.submitHumanMove(game.id, {
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    expect(moved.moves).toHaveLength(2);
    expect(
      traceHub.snapshot({ layer: 'llama' }).map((event) => event.stage),
    ).toEqual([
      'attempt_started',
      'retry_scheduled',
      'attempt_started',
      'selection_completed',
    ]);
    expect(traceHub.snapshot({ layer: 'llama' })[1]?.data).toEqual({
      attempt: 1,
      reason: 'timeout',
    });
  });

  it.each(['stockfish', 'llama', 'storage'] as const)(
    'publishes sanitized %s failure and a terminal gateway event',
    async (layer) => {
      const { service, stockfish, selector, games, traceHub } =
        createServiceHarness();
      if (layer === 'stockfish')
        vi.spyOn(stockfish, 'analyze').mockRejectedValue(
          new Error('secret transcript'),
        );
      if (layer === 'llama') selector.error = new Error('secret prompt');
      if (layer === 'storage')
        vi.spyOn(games, 'recordAiMove').mockImplementation(() => {
          throw new Error('secret db');
        });
      const game = await service.createGame({ humanColor: 'white' });
      await expect(
        service.submitHumanMove(game.id, {
          from: 'e2',
          to: 'e4',
          expectedPly: 0,
        }),
      ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
      const events = traceHub.snapshot({});
      expect(events.slice(-2).map((event) => event.stage)).toEqual([
        layer === 'stockfish'
          ? 'analysis_failed'
          : layer === 'llama'
            ? 'selection_failed'
            : 'decision_failed',
        'ai_turn_failed',
      ]);
      expect(events.at(-1)?.data).toEqual({ reason: layer });
      expect(JSON.stringify(events)).not.toContain('secret');
      expect(games.getRequired(game.id).moves).toHaveLength(1);
    },
  );

  it('ends cancelled turns with a single cancellation terminal event', async () => {
    const { service, selector, traceHub } = createServiceHarness();
    const controller = new AbortController();
    selector.error = new DOMException('private detail', 'AbortError');
    const game = await service.createGame({ humanColor: 'white' });
    controller.abort();
    await expect(
      service.submitHumanMove(
        game.id,
        { from: 'e2', to: 'e4', expectedPly: 0 },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(traceHub.snapshot({}).at(-1)).toMatchObject({
      layer: 'client',
      stage: 'request_cancelled',
      status: 'cancelled',
      data: {},
    });
    expect(
      traceHub.snapshot({}).some((event) => event.status === 'failed'),
    ).toBe(false);
  });

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

  it('domain-validates a shortlisted model move before persistence', async () => {
    const harness = createServiceHarness({
      selectedUci: 'e1e2',
      candidateUcis: ['e1e2'],
    });
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
    expect(
      harness.games.getRequired(game.id).moves.map((move) => move.uci),
    ).toEqual(['e2e4']);
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

  it('exports a resigned game with its single result marker', async () => {
    const harness = createServiceHarness();
    const game = await harness.service.createGame({ humanColor: 'white' });
    const resigned = await harness.service.resignGame(game.id, 0);
    expect(resigned.status).toBe('completed');
    expect(await harness.service.exportPgn(game.id)).toBe('0-1');
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
