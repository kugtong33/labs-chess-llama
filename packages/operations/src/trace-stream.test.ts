import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  formatTraceEvent,
  formatTraceStream,
  parseTraceStream,
} from './trace-stream.js';

const event = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  sequence: 0,
  timestamp: '2026-09-18T12:34:56.789Z',
  traceId: '22222222-2222-4222-8222-222222222222',
  requestId: 'request-1',
  gameId: '33333333-3333-4333-8333-333333333333',
  ply: 2,
  layer: 'llama',
  stage: 'selection_completed',
  status: 'completed',
  summary: 'Selected e7e5 after evaluating candidates.',
  data: {
    selectedMove: 'e7e5',
    retryCount: 1,
    commentary: 'Central control.',
    modelId: 'Qwen3-4B-Q4_K_M.gguf',
    latencyMs: 842,
    promptTokens: 128,
    completionTokens: 12,
    tokensPerSecond: 14.3,
  },
} as const;

function frame(value: { id: string } = event): string {
  return `id: ${value.id}\nevent: decision-trace\ndata: ${JSON.stringify(value)}\n\n`;
}

describe('trace stream formatter', () => {
  it('preserves UTF-8 characters fragmented across byte chunks', async () => {
    const unicode = { ...event, summary: 'A strong move ♞.' };
    const bytes = Buffer.from(frame(unicode));
    const split = bytes.indexOf(Buffer.from('♞')) + 1;

    await expect(
      collect(
        parseTraceStream(
          Readable.from([bytes.subarray(0, split), bytes.subarray(split)]),
        ),
      ),
    ).resolves.toEqual([unicode]);
  });

  it('parses a decision trace whose SSE fields arrive in fragmented chunks', async () => {
    const chunks = [
      'id: 11111111-1111-4111-8111-',
      '111111111111\nevent: decision-trace\ndata: {"schemaVersion":1,',
      `${JSON.stringify(event).slice('{"schemaVersion":1,'.length)}\n\n`,
    ];

    await expect(
      collect(parseTraceStream(Readable.from(chunks))),
    ).resolves.toEqual([event]);
  });

  it('ignores SSE comment frames without dropping a following trace', async () => {
    await expect(
      collect(
        parseTraceStream(
          Readable.from([': connected\n\n: heartbeat\n\n', frame()]),
        ),
      ),
    ).resolves.toEqual([event]);
  });

  it('renders a compact human line with correlation and curated model details', () => {
    expect(formatTraceEvent(event, 'human')).toBe(
      '12:34:56.789Z LLAMA selection_completed/completed trace=22222222 game=33333333 Selected e7e5 after evaluating candidates. move=e7e5 retry=1 model=Qwen3-4B-Q4_K_M.gguf latency=842ms tokens=128+12 tps=14.3 commentary=Central control.',
    );
  });

  it('renders each event as one JSONL record', () => {
    expect(formatTraceEvent(event, 'json')).toBe(JSON.stringify(event));
  });

  it('rejects malformed decision trace events', async () => {
    const invalid = { ...event, data: { rawResponse: 'secret' } };

    await expect(
      collect(parseTraceStream(Readable.from([frame(invalid)]))),
    ).rejects.toThrow('Invalid decision trace event');
  });

  it('rejects duplicate SSE event IDs', async () => {
    await expect(
      collect(parseTraceStream(Readable.from([frame(), frame()]))),
    ).rejects.toThrow(`Duplicate decision trace event ID: ${event.id}`);
  });

  it('bounds duplicate suppression to the backend retained event window', async () => {
    const events = Array.from({ length: 201 }, (_, index) => ({
      ...event,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      sequence: index + 1,
    }));

    const parsed = await collect(
      parseTraceStream(Readable.from([...events.map(frame), frame(events[0])])),
    );

    expect(parsed).toHaveLength(202);
    expect(parsed.at(-1)?.id).toBe(events[0]?.id);
  });

  it('finishes cleanly when the stream ends after complete frames', async () => {
    const output: string[] = [];

    await expect(
      formatTraceStream(Readable.from([frame()]), 'json', (line) =>
        output.push(line),
      ),
    ).resolves.toBeUndefined();
    expect(output.map((line) => JSON.parse(line) as unknown)).toEqual([event]);
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
