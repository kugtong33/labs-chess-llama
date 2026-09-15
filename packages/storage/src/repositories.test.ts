import { afterEach, describe, expect, it } from 'vitest';

import {
  backupDatabase,
  getMigrationStatus,
  migrateDatabase,
} from './database.js';
import { createTestStorage } from './test-support.js';

const harnesses: Array<ReturnType<typeof createTestStorage>> = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

function newHarness() {
  const harness = createTestStorage();
  harnesses.push(harness);
  return harness;
}

function humanMove(id = crypto.randomUUID()) {
  return {
    id,
    ply: 1,
    color: 'white' as const,
    actor: 'human' as const,
    uci: 'e2e4' as const,
    san: 'e4',
    fenAfter: 'fen-after-e4',
    pgnAfter: '1. e4',
  };
}

function aiMove() {
  return {
    id: crypto.randomUUID(),
    ply: 2,
    color: 'black' as const,
    actor: 'llm' as const,
    uci: 'e7e5' as const,
    san: 'e5',
    fenAfter: 'fen-after-e5',
    pgnAfter: '1. e4 e5',
  };
}

function aiDecision(moveId: string) {
  return {
    id: crypto.randomUUID(),
    moveId,
    candidates: [
      {
        rank: 1,
        uci: 'e7e5' as const,
        san: 'e5',
        score: { type: 'cp' as const, value: 24 },
        normalizedScore: 24,
      },
    ],
    chosenUci: 'e7e5' as const,
    commentary: 'A principled reply.',
    modelId: 'qwen3',
    profileId: 'qwen3-4b-q4-k-m',
    quantization: 'Q4_K_M',
    latencyMs: 42,
    promptTokens: 100,
    completionTokens: 12,
    tokensPerSecond: 28.5,
    retryCount: 0 as const,
  };
}

describe('SQLite repositories', () => {
  it('persists an awaiting AI turn across reopen', () => {
    const harness = newHarness();
    const game = harness.games.create({
      humanColor: 'white',
      modelProfileId: 'qwen3-4b-q4-k-m',
    });

    harness.games.recordHumanMove(game.id, humanMove());
    harness.closeAndReopen();

    expect(harness.games.getRequired(game.id).status).toBe('awaiting_ai');
    expect(harness.games.getRequired(game.id).moves).toHaveLength(1);
  });

  it('rejects duplicate ply and persists settings', () => {
    const harness = newHarness();
    const game = harness.games.create({
      humanColor: 'white',
      modelProfileId: 'qwen3-4b-q4-k-m',
    });
    const move = humanMove();

    harness.games.recordHumanMove(game.id, move);
    expect(() =>
      harness.games.recordHumanMove(game.id, {
        ...move,
        id: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(harness.games.getRequired(game.id).moves).toHaveLength(1);
    expect(harness.settings.update({ theme: 'dark' }).theme).toBe('dark');
    expect(harness.settings.get().theme).toBe('dark');
  });

  it('records an AI move and decision atomically', () => {
    const harness = newHarness();
    const game = harness.games.create({
      humanColor: 'white',
      modelProfileId: 'qwen3-4b-q4-k-m',
    });
    harness.games.recordHumanMove(game.id, humanMove());

    const move = aiMove();
    const decision = { ...aiDecision(move.id), createdAt: 1_700_000_000_000 };
    const updated = harness.games.recordAiMove(game.id, move, decision);

    expect(updated.status).toBe('active');
    expect(updated.currentFen).toBe('fen-after-e5');
    expect(updated.pgn).toBe('1. e4 e5');
    expect(updated.moves.map(({ uci }) => uci)).toEqual(['e2e4', 'e7e5']);
    expect(updated.lastAiDecision?.chosenUci).toBe('e7e5');
    expect(updated.lastAiDecision?.createdAt).toBe(1_700_000_000_000);
  });

  it('rolls back an AI move when the later decision insert fails', () => {
    const harness = newHarness();
    const game = harness.games.create({
      humanColor: 'white',
      modelProfileId: 'qwen3-4b-q4-k-m',
    });
    harness.games.recordHumanMove(game.id, humanMove());

    const firstMove = aiMove();
    const firstDecision = aiDecision(firstMove.id);
    harness.games.recordAiMove(game.id, firstMove, firstDecision);

    const move = { ...aiMove(), ply: 3 };
    expect(() =>
      harness.games.recordAiMove(game.id, move, {
        ...aiDecision(move.id),
        id: firstDecision.id,
      }),
    ).toThrow();

    const unchanged = harness.games.getRequired(game.id);
    expect(unchanged.moves).toHaveLength(2);
    expect(unchanged.moves.at(-1)?.id).toBe(firstMove.id);
    expect(unchanged.lastAiDecision?.moveId).toBe(firstMove.id);
  });

  it('selects the highest-ply decision when timestamps are equal', () => {
    const harness = newHarness();
    const game = harness.games.create({
      humanColor: 'white',
      modelProfileId: 'qwen3-4b-q4-k-m',
    });
    harness.games.recordHumanMove(game.id, humanMove());

    const firstMove = aiMove();
    const timestamp = 1_700_000_000_000;
    harness.games.recordAiMove(game.id, firstMove, {
      ...aiDecision(firstMove.id),
      createdAt: timestamp,
    });
    const secondMove = { ...aiMove(), ply: 3 };
    harness.games.recordAiMove(game.id, secondMove, {
      ...aiDecision(secondMove.id),
      createdAt: timestamp,
    });

    expect(harness.games.getRequired(game.id).lastAiDecision?.moveId).toBe(
      secondMove.id,
    );
  });

  it('keeps migration idempotent and reports a current migration', () => {
    const harness = newHarness();
    expect(() => migrateDatabase(harness.db)).not.toThrow();
    expect(getMigrationStatus(harness.db)).toEqual({
      current: '0000_initial',
      expected: '0000_initial',
      pending: false,
    });
  });

  it('enforces SQLite pragmas and persists an online backup', async () => {
    const harness = newHarness();
    const game = harness.games.create({
      humanColor: 'white',
      modelProfileId: 'qwen3-4b-q4-k-m',
    });
    const destination = `${harness.path}.backup`;

    expect(harness.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(harness.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(harness.db.pragma('synchronous', { simple: true })).toBe(1);
    expect(harness.db.pragma('journal_mode', { simple: true })).toBe('wal');

    await backupDatabase(harness.db, destination);
    const backup = createTestStorage(destination);
    harnesses.push(backup);
    expect(backup.games.getRequired(game.id).id).toBe(game.id);
  });
});
