// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseDecisionTraceEvent,
  useDecisionEvents,
  type DecisionEventSource,
} from './decision-events.js';

const event = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  sequence: 1,
  timestamp: '2026-09-18T00:00:00.000Z',
  traceId: '22222222-2222-4222-8222-222222222222',
  requestId: 'req-1',
  gameId: '33333333-3333-4333-8333-333333333333',
  ply: 2,
  layer: 'llama',
  stage: 'retry_scheduled',
  status: 'retrying',
  summary: 'Retrying model selection.',
  data: { attempt: 1, reason: 'timeout' },
} as const;

class FakeEventSource implements DecisionEventSource {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  closed = false;
  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data = '') {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('decision event adapter', () => {
  it('validates only strict decision-trace payloads', () => {
    expect(parseDecisionTraceEvent(JSON.stringify(event))).toMatchObject(event);
    expect(parseDecisionTraceEvent('{bad json')).toBeNull();
    expect(
      parseDecisionTraceEvent(JSON.stringify({ ...event, prompt: 'raw' })),
    ).toBeNull();
  });

  it('deduplicates events, bounds memory, and tracks reconnection state', async () => {
    const source = new FakeEventSource();
    const { result, unmount } = renderHook(() =>
      useDecisionEvents('http://gateway/api/demo/events?gameId=game', {
        createEventSource: () => source,
        maxEvents: 2,
      }),
    );

    await waitFor(() =>
      expect(source.listeners.get('decision-trace')?.size).toBe(1),
    );
    source.emit('open');
    source.emit('decision-trace', JSON.stringify(event));
    source.emit('decision-trace', JSON.stringify(event));
    source.emit(
      'decision-trace',
      JSON.stringify({
        ...event,
        id: '44444444-4444-4444-8444-444444444444',
        sequence: 2,
      }),
    );
    source.emit(
      'decision-trace',
      JSON.stringify({
        ...event,
        id: '55555555-5555-4555-8555-555555555555',
        sequence: 3,
      }),
    );

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.events.map(({ sequence }) => sequence)).toEqual([
      2, 3,
    ]);
    expect(result.current.connection).toBe('connected');
    source.emit('error');
    await waitFor(() => expect(result.current.connection).toBe('disconnected'));
    unmount();
    expect(source.closed).toBe(true);
  });

  it('falls back cleanly when tracing is disabled', () => {
    const createEventSource = () => {
      throw new Error('must not connect');
    };
    const { result } = renderHook(() =>
      useDecisionEvents('http://gateway/events', {
        enabled: false,
        createEventSource,
      }),
    );
    expect(result.current).toMatchObject({
      connection: 'disabled',
      events: [],
    });
  });

  it('clears traces and starts a bounded dedupe window when the game URL changes', async () => {
    const first = new FakeEventSource();
    const second = new FakeEventSource();
    const sources = [first, second];
    const { result, rerender } = renderHook(
      ({ url }) =>
        useDecisionEvents(url, {
          createEventSource: () => sources.shift()!,
          maxEvents: 2,
        }),
      { initialProps: { url: 'http://gateway/events?gameId=first' } },
    );
    await waitFor(() =>
      expect(first.listeners.get('decision-trace')?.size).toBe(1),
    );
    first.emit('decision-trace', JSON.stringify(event));
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ url: 'http://gateway/events?gameId=second' });
    await waitFor(() => expect(result.current.events).toEqual([]));
    expect(first.closed).toBe(true);
    await waitFor(() =>
      expect(second.listeners.get('decision-trace')?.size).toBe(1),
    );
    second.emit(
      'decision-trace',
      JSON.stringify({ ...event, id: '44444444-4444-4444-8444-444444444444' }),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
  });

  it('retains dedupe IDs only for the bounded visible event history', async () => {
    const source = new FakeEventSource();
    const { result } = renderHook(() =>
      useDecisionEvents('http://gateway/events', {
        createEventSource: () => source,
        maxEvents: 2,
      }),
    );
    await waitFor(() =>
      expect(source.listeners.get('decision-trace')?.size).toBe(1),
    );
    const second = {
      ...event,
      id: '44444444-4444-4444-8444-444444444444',
      sequence: 2,
    };
    const third = {
      ...event,
      id: '55555555-5555-4555-8555-555555555555',
      sequence: 3,
    };
    source.emit('decision-trace', JSON.stringify(event));
    source.emit('decision-trace', JSON.stringify(second));
    source.emit('decision-trace', JSON.stringify(third));
    await waitFor(() =>
      expect(result.current.events.map(({ sequence }) => sequence)).toEqual([
        2, 3,
      ]),
    );
    source.emit('decision-trace', JSON.stringify(third));
    await waitFor(() =>
      expect(result.current.events.map(({ sequence }) => sequence)).toEqual([
        2, 3,
      ]),
    );
    source.emit('decision-trace', JSON.stringify(event));
    await waitFor(() =>
      expect(result.current.events.map(({ sequence }) => sequence)).toEqual([
        3, 1,
      ]),
    );
  });
});
