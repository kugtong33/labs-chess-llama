import { describe, expect, it, vi } from 'vitest';

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
    data: { attempt: 0 as const },
    ...overrides,
  };
}

describe('DecisionTraceHub', () => {
  it('assigns ordered event metadata', () => {
    const hub = new DecisionTraceHub();

    const first = hub.publish(event());
    const second = hub.publish(event({ data: { attempt: 1 } }));

    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect([first.sequence, second.sequence]).toEqual([0, 1]);
    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
        data: { decisionId: '2b546572-0003-49e5-b55c-dbc8e3818fa2' },
      }),
    );

    expect(hub.snapshot({ layer: 'llama' })).toHaveLength(1);
    expect(hub.snapshot({ gameId: gameTwo })).toMatchObject([
      { layer: 'storage', gameId: gameTwo },
    ]);
  });

  it('replays matching buffered events and stops after unsubscribe', () => {
    const hub = new DecisionTraceHub();
    hub.publish(event());
    const listener = vi.fn();

    const unsubscribe = hub.subscribe({ gameId: gameOne }, listener);
    hub.publish(event({ data: { attempt: 1 } }));
    unsubscribe();
    hub.publish(event());

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.map(([value]) => value.sequence)).toEqual([
      0, 1,
    ]);
  });

  it('isolates throwing listeners while publishing to healthy subscribers', () => {
    const hub = new DecisionTraceHub();
    const healthy = vi.fn();
    hub.subscribe({}, () => {
      throw new Error('subscriber disconnected');
    });
    hub.subscribe({}, healthy);

    expect(() => hub.publish(event())).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
