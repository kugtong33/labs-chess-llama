import { buildPrompt, buildSystemPrompt } from './prompt.js';
import { buildMoveResponseFormat } from './schema.js';
import type {
  LlamaCppClientOptions,
  ModelHealth,
  MoveSelection,
  MoveSelector,
  SelectMoveRequest,
} from './types.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 8_000;

interface WireMessage {
  content?: unknown;
}

class TimeoutError extends Error {
  constructor() {
    super('llama.cpp request timed out');
    this.name = 'TimeoutError';
  }
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`llama.cpp HTTP ${status}`);
    this.name = 'HttpError';
  }
}

class InvalidCompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCompletionError';
  }
}

export class LlamaCppClient implements MoveSelector {
  private readonly baseUrl: string;
  private readonly modelId: string | null;
  private readonly profileId: string | null;
  private readonly quantization: string | null;
  private readonly backend: string | null;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: LlamaCppClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.modelId = options.modelId ?? null;
    this.profileId = options.profileId ?? null;
    this.quantization = options.quantization ?? null;
    this.backend = options.backend ?? null;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async health(signal?: AbortSignal): Promise<ModelHealth> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/health`,
        { method: 'GET' },
        signal,
      );
      if (!response.ok) {
        return {
          status: 'unavailable',
          modelId: this.modelId,
          profileId: this.profileId,
          quantization: this.quantization,
          backend: this.backend,
          detail: `HTTP ${response.status}`,
        };
      }
      return {
        status: 'ready',
        modelId: this.modelId,
        profileId: this.profileId,
        quantization: this.quantization,
        backend: this.backend,
      };
    } catch (error) {
      if (isAbortError(error, signal)) throw toAbortError();
      return {
        status: 'unavailable',
        modelId: this.modelId,
        profileId: this.profileId,
        quantization: this.quantization,
        backend: this.backend,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async selectMove(request: SelectMoveRequest): Promise<MoveSelection> {
    if (request.candidates.length === 0) {
      throw new Error('At least one candidate is required');
    }
    if (request.signal?.aborted) throw toAbortError();

    const body = this.buildRequestBody(request);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.selectOnce(request, body, attempt === 0 ? 0 : 1);
      } catch (error) {
        if (isAbortError(error, request.signal)) throw toAbortError();
        if (attempt === 0 && shouldRetry(error)) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  private buildRequestBody(
    request: SelectMoveRequest,
  ): Record<string, unknown> {
    return {
      model: request.modelProfileId,
      temperature: 0.2,
      max_tokens: 128,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: buildPrompt(request),
        },
      ],
      response_format: buildMoveResponseFormat(request.candidates),
    };
  }

  private async selectOnce(
    request: SelectMoveRequest,
    body: Record<string, unknown>,
    retryCount: 0 | 1,
  ): Promise<MoveSelection> {
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      request.signal,
    );
    if (!response.ok) {
      throw new HttpError(response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InvalidCompletionError('llama.cpp returned invalid JSON');
    }
    const parsed = parseCompletion(
      payload,
      request.candidates,
      this.modelId ?? request.modelProfileId,
    );
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return {
      ...parsed,
      latencyMs,
      retryCount,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (signal?.aborted) throw toAbortError();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: () => void = () => {};
    const callerAbort = signal
      ? new Promise<never>((_, reject) => {
          const onAbort = () => reject(toAbortError());
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () =>
            signal.removeEventListener('abort', onAbort);
        })
      : new Promise<never>(() => {});
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError());
      }, this.timeoutMs);
    });
    try {
      const fetchPromise = this.fetcher(url, {
        ...init,
        signal: controller.signal,
      });
      return await Promise.race([fetchPromise, timeout, callerAbort]);
    } catch (error) {
      if (signal?.aborted) throw toAbortError();
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeAbortListener();
      controller.abort();
    }
  }
}

function parseCompletion(
  payload: unknown,
  candidates: readonly { uci: string }[],
  fallbackModelId: string,
): Omit<MoveSelection, 'latencyMs' | 'retryCount'> {
  if (!isRecord(payload)) {
    throw new InvalidCompletionError('llama.cpp response is not an object');
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new InvalidCompletionError('llama.cpp response has no choices');
  }
  const firstChoice = choices[0] as unknown;
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new InvalidCompletionError('llama.cpp response has no message');
  }
  const content = (firstChoice.message as WireMessage).content;
  if (typeof content !== 'string') {
    throw new InvalidCompletionError(
      'llama.cpp message content is not JSON text',
    );
  }
  let selected: unknown;
  try {
    selected = JSON.parse(content);
  } catch {
    throw new InvalidCompletionError(
      'llama.cpp message content is invalid JSON',
    );
  }
  if (!isRecord(selected)) {
    throw new InvalidCompletionError('llama.cpp selection is not an object');
  }
  const move = selected.move;
  const commentary = selected.commentary;
  if (
    typeof move !== 'string' ||
    !candidates.some((candidate) => candidate.uci === move)
  ) {
    throw new InvalidCompletionError('llama.cpp selected a non-candidate move');
  }
  if (
    typeof commentary !== 'string' ||
    commentary.length < 1 ||
    commentary.length > 240
  ) {
    throw new InvalidCompletionError('llama.cpp commentary is out of bounds');
  }

  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  const timings = isRecord(payload.timings) ? payload.timings : undefined;
  const promptTokens = integerOrNull(usage?.prompt_tokens);
  const completionTokens = integerOrNull(usage?.completion_tokens);
  const tokensPerSecond = nonnegativeOrNull(timings?.predicted_per_second);
  return {
    uci: move,
    commentary,
    modelId:
      typeof payload.model === 'string' ? payload.model : fallbackModelId,
    promptTokens,
    completionTokens,
    tokensPerSecond,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function nonnegativeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

function toAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function shouldRetry(error: unknown): boolean {
  if (
    error instanceof TimeoutError ||
    error instanceof InvalidCompletionError
  ) {
    return true;
  }
  if (error instanceof HttpError) return RETRYABLE_STATUS.has(error.status);
  return error instanceof Error;
}
