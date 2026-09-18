import { describe, expect, it, vi } from 'vitest';
import type { DecisionTraceEvent } from '@chess-llama/contracts';

import { DecisionTraceHub } from './decision-trace-hub.js';

const traceId = 'd722a68e-97c5-43d8-b0ca-1ba91ba3392f';
const gameOne = '8fdbe143-cb5b-465d-90e9-70e5a7d19a44';
const gameTwo = 'f0f3c534-05dc-4472-9244-3cf1817c2d35';

function event(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    traceId,
    requestId: 'req-42',
    gameId: gameOne,
    ply: 2,
    layer: 'llama' as const,
    stage: 'attempt_started' as const,
    status: 'running' as const,
    summary: 'Requesting a model selection.',
    data: {
      attempt: 0 as const,
      profileId: 'profile',
      candidates: [{ rank: 1, uci: 'e7e5', san: 'e5' }],
    },
    ...overrides,
  };
}

describe('DecisionTraceHub', () => {
  it('returns from publish before running a blocking synchronous observer', async () => {
    const hub = new DecisionTraceHub();
    const order: string[] = [];
    let delivered!: () => void;
    const delivery = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    hub.subscribe({}, () => {
      order.push('observer started');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
      order.push('observer finished');
      delivered();
    });
    hub.publish(event());
    order.push('publish returned');
    expect(order).toEqual(['publish returned']);
    await delivery;
    expect(order).toEqual([
      'publish returned',
      'observer started',
      'observer finished',
    ]);
  });

  it('bounds a stalled subscriber queue and independently delivers to healthy subscribers', async () => {
    const hub = new DecisionTraceHub();
    const slow: number[] = [];
    const healthy: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    let slowDone!: () => void;
    let healthyDone!: () => void;
    const slowCompletion = new Promise<void>((resolve) => {
      slowDone = resolve;
    });
    const healthyCompletion = new Promise<void>((resolve) => {
      healthyDone = resolve;
    });
    hub.subscribe({}, async (value) => {
      slow.push(value.sequence);
      if (value.sequence === 0) {
        started();
        await gate;
      }
      if (value.sequence === 205) slowDone();
    });
    hub.subscribe({}, (value) => {
      healthy.push(value.sequence);
      if (value.sequence === 205) healthyDone();
    });
    hub.publish(event());
    await start;
    for (let index = 1; index <= 205; index += 1) hub.publish(event());
    await healthyCompletion;
    expect(slow).toEqual([0]);
    release();
    await slowCompletion;
    expect(slow).toHaveLength(201);
    expect(slow.slice(0, 3)).toEqual([0, 6, 7]);
    expect(slow.at(-1)).toBe(205);
    expect(healthy.at(-1)).toBe(205);
    expect(hub.snapshot({})).toHaveLength(200);
  });

  it('does not invoke replay or queued live events after unsubscribe', async () => {
    const hub = new DecisionTraceHub();
    hub.publish(event());
    const received: number[] = [];
    const unsubscribe = hub.subscribe({}, (value) => {
      received.push(value.sequence);
    });
    hub.publish(event());
    unsubscribe();
    await new Promise((resolve) => setImmediate(resolve));
    expect(received).toEqual([]);
  });
  it('assigns ordered event metadata', () => {
    const hub = new DecisionTraceHub();

    const first = hub.publish(event());
    const second = hub.publish(event());

    if (first === null || second === null) throw new Error('Expected trace');

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect([first.sequence, second.sequence]).toEqual([0, 1]);
    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('drops invalid publication without interrupting later valid work', () => {
    const hub = new DecisionTraceHub();

    expect(hub.publish(event({ summary: 'x'.repeat(241) }))).toBeNull();
    const valid = hub.publish(event());

    expect(valid).toMatchObject({ sequence: 0 });
    expect(hub.snapshot({})).toHaveLength(1);
  });

  it('keeps only the latest 200 events', () => {
    const hub = new DecisionTraceHub();

    for (let index = 0; index < 201; index += 1) {
      hub.publish(event({ summary: `Attempt ${index}` }));
    }

    const snapshot = hub.snapshot({});
    expect(snapshot).toHaveLength(200);
    expect(snapshot[0]?.sequence).toBe(1);
    expect(snapshot.at(-1)?.sequence).toBe(200);
  });

  it('filters snapshots by layer and game', () => {
    const hub = new DecisionTraceHub();
    hub.publish(event());
    hub.publish(
      event({
        gameId: gameTwo,
        layer: 'storage',
        stage: 'decision_persisted',
        status: 'completed',
        data: {
          decisionId: '2b546572-0003-49e5-b55c-dbc8e3818fa2',
          moveId: '2b546572-0003-49e5-b55c-dbc8e3818fa3',
          chosenUci: 'e7e5',
        },
      }),
    );

    expect(hub.snapshot({ layer: 'llama' })).toHaveLength(1);
    expect(hub.snapshot({ gameId: gameTwo })).toMatchObject([
      { layer: 'storage', gameId: gameTwo },
    ]);
  });

  it('replays matching buffered events and stops after unsubscribe', async () => {
    const hub = new DecisionTraceHub();
    hub.publish(event());
    let delivered!: () => void;
    const delivery = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    const listener = vi.fn<(event: DecisionTraceEvent) => void>((value) => {
      if (value.sequence === 1) delivered();
    });

    const unsubscribe = hub.subscribe({ gameId: gameOne }, listener);
    hub.publish(event());
    await delivery;
    unsubscribe();
    hub.publish(event());
    await new Promise((resolve) => setImmediate(resolve));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([value]) => value.sequence)).toEqual([
      0, 1,
    ]);
  });

  it('isolates throwing listeners while publishing to healthy subscribers', async () => {
    const hub = new DecisionTraceHub();
    const healthy = vi.fn();
    hub.subscribe({}, () => {
      throw new Error('subscriber disconnected');
    });
    hub.subscribe({}, healthy);

    expect(() => hub.publish(event())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
