import { describe, expect, it, vi } from 'vitest';

import { LlamaCppClient } from './index.js';

const candidates = [
  { rank: 1, uci: 'e7e5', san: 'e5' },
  { rank: 2, uci: 'c7c5', san: 'c5' },
];
const request = {
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  sanHistory: ['e4'],
  candidates,
  commentaryStyle: 'concise' as const,
  modelProfileId: 'qwen3-4b-q4-k-m',
};

function completion(content: unknown, overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'qwen3-4b-q4-k-m',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            reasoning_content: 'must never escape',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
      timings: { predicted_per_second: 24.5 },
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('llama.cpp HTTP boundary', () => {
  it('sends structured chat and returns provider-neutral selection metrics', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        completion(
          JSON.stringify({ move: 'e7e5', commentary: 'Controls the centre.' }),
        ),
      );
    const client = new LlamaCppClient({
      baseUrl: 'http://127.0.0.1:8080/',
      fetch: fetcher,
    });

    const selection = await client.selectMove(request);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '',
    ) as Record<string, unknown>;

    expect(url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(body).toMatchObject({
      model: 'qwen3-4b-q4-k-m',
      temperature: 0.2,
      max_tokens: 128,
    });
    expect(selection).toMatchObject({
      uci: 'e7e5',
      commentary: 'Controls the centre.',
      modelId: 'qwen3-4b-q4-k-m',
      promptTokens: 40,
      completionTokens: 12,
      tokensPerSecond: 24.5,
      retryCount: 0,
    });
    expect(selection.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body)).not.toContain('must never escape');
  });

  it('keeps a successful response body readable after headers resolve', async () => {
    const body = JSON.stringify({
      id: 'chatcmpl-stream',
      model: 'qwen3-4b-q4-k-m',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({ move: 'e7e5', commentary: 'Develops.' }),
          },
        },
      ],
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              init?.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError')),
              );
              queueMicrotask(() => {
                if (!init?.signal?.aborted) {
                  controller.enqueue(encoder.encode(body));
                  controller.close();
                }
              });
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.selectMove(request)).resolves.toMatchObject({
      uci: 'e7e5',
    });
  });

  it('retries invalid JSON exactly once and reports retryCount one', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completion('{not json'))
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            move: 'c7c5',
            commentary: 'Challenges the centre.',
          }),
        ),
      );
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.selectMove(request)).resolves.toMatchObject({
      uci: 'c7c5',
      retryCount: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries a non-candidate response and then accepts the bounded choice', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        completion(JSON.stringify({ move: 'a1a2', commentary: 'No.' })),
      )
      .mockResolvedValueOnce(
        completion(JSON.stringify({ move: 'e7e5', commentary: 'Develops.' })),
      );
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.selectMove(request)).resolves.toMatchObject({
      uci: 'e7e5',
      retryCount: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retries a transient server response once', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        completion(JSON.stringify({ move: 'e7e5', commentary: 'Develops.' })),
      );
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.selectMove(request)).resolves.toMatchObject({
      uci: 'e7e5',
      retryCount: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['timeout', () => new Promise<Response>(() => undefined)],
    [
      'http',
      () => Promise.resolve(new Response('provider body', { status: 503 })),
    ],
    ['invalid_completion', () => Promise.resolve(completion('{not json'))],
    ['transport', () => Promise.reject(new Error('provider body'))],
  ] as const)(
    'reports sanitized %s retry progress without provider bodies',
    async (reason, firstAttempt) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(firstAttempt)
        .mockResolvedValueOnce(
          completion(JSON.stringify({ move: 'e7e5', commentary: 'Develops.' })),
        );
      const progress: unknown[] = [];
      const client = new LlamaCppClient({ fetch: fetcher, timeoutMs: 1 });

      await expect(
        client.selectMove({
          ...request,
          onProgress: (event) => progress.push(event),
        }),
      ).resolves.toMatchObject({ retryCount: 1 });

      expect(progress).toEqual([
        { type: 'attempt_started', attempt: 0 },
        { type: 'retry_scheduled', attempt: 1, reason },
        { type: 'attempt_started', attempt: 1 },
      ]);
      expect(JSON.stringify(progress)).not.toContain('provider body');
    },
  );

  it.each([
    [
      'synchronously',
      () => {
        throw new Error('observer failed');
      },
    ],
    ['asynchronously', () => Promise.reject(new Error('observer failed'))],
  ])(
    'continues move selection when progress observation fails %s',
    async (_delivery, onProgress) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          completion(JSON.stringify({ move: 'e7e5', commentary: 'Develops.' })),
        );
      const client = new LlamaCppClient({ fetch: fetcher });

      await expect(
        client.selectMove({ ...request, onProgress }),
      ).resolves.toMatchObject({ uci: 'e7e5' });
    },
  );

  it('retries a network timeout once and then surfaces the timeout', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => undefined));
    const client = new LlamaCppClient({ fetch: fetcher, timeoutMs: 1 });

    await expect(client.selectMove(request)).rejects.toThrow('timed out');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled response body and retries the attempt', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError')),
              );
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new LlamaCppClient({ fetch: fetcher, timeoutMs: 5 });

    await expect(client.selectMove(request)).rejects.toThrow('timed out');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects extra response keys and retries with strict application validation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            move: 'e7e5',
            commentary: 'Develops.',
            extra: 'must reject',
          }),
        ),
      )
      .mockResolvedValueOnce(
        completion(JSON.stringify({ move: 'e7e5', commentary: 'Develops.' })),
      );
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.selectMove(request)).resolves.toMatchObject({
      uci: 'e7e5',
      retryCount: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable client HTTP error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 400 }));
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.selectMove(request)).rejects.toThrow('HTTP 400');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps health responses without exposing wire fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const client = new LlamaCppClient({ fetch: fetcher });

    await expect(client.health()).resolves.toMatchObject({ status: 'ready' });
    await expect(client.health()).resolves.toMatchObject({
      status: 'unavailable',
    });
  });

  it('honours caller cancellation without retrying', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new LlamaCppClient({ fetch: fetcher });
    const pending = client.selectMove({
      ...request,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
