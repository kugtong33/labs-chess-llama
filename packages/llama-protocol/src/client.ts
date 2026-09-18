import { buildPrompt, buildSystemPrompt } from './prompt.js';
import { buildMoveResponseFormat } from './schema.js';
import type {
  LlamaCppClientOptions,
  LlamaRetryReason,
  ModelHealth,
  MoveSelection,
  MoveSelector,
  SelectMoveRequest,
  SelectMoveProgressEvent,
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
      const response = await this.withAttemptTimeout(signal, (internalSignal) =>
        this.fetcher(`${this.baseUrl}/health`, {
          method: 'GET',
          signal: internalSignal,
        }),
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
      notifyProgress(request, {
        type: 'attempt_started',
        attempt: attempt === 0 ? 0 : 1,
      });
      try {
        return await this.selectOnce(request, body, attempt === 0 ? 0 : 1);
      } catch (error) {
        if (isAbortError(error, request.signal)) throw toAbortError();
        if (attempt === 0 && shouldRetry(error)) {
          notifyProgress(request, {
            type: 'retry_scheduled',
            attempt: 1,
            reason: retryReason(error),
          });
          continue;
        }
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
    const parsed = await this.withAttemptTimeout(
      request.signal,
      async (internalSignal) => {
        const response = await this.fetcher(
          `${this.baseUrl}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: internalSignal,
          },
        );
        if (!response.ok) {
          throw new HttpError(response.status);
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (internalSignal.aborted) throw error;
          throw new InvalidCompletionError('llama.cpp returned invalid JSON');
        }
        return parseCompletion(
          payload,
          request.candidates,
          this.modelId ?? request.modelProfileId,
        );
      },
    );
    const latencyMs = Math.max(0, Date.now() - startedAt);
    return {
      ...parsed,
      latencyMs,
      retryCount,
    };
  }

  private async withAttemptTimeout<T>(
    signal?: AbortSignal,
    operation?: (internalSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) throw toAbortError();
    if (operation === undefined) {
      throw new Error('Attempt operation is required');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
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
        timedOut = true;
        controller.abort();
        reject(new TimeoutError());
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        operation(controller.signal),
        timeout,
        callerAbort,
      ]);
    } catch (error) {
      if (signal?.aborted) throw toAbortError();
      if (timedOut) throw new TimeoutError();
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
  const selectionKeys = Object.keys(selected);
  if (
    selectionKeys.length !== 2 ||
    !selectionKeys.includes('move') ||
    !selectionKeys.includes('commentary')
  ) {
    throw new InvalidCompletionError(
      'llama.cpp selection contains unexpected keys',
    );
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
  return signal?.aborted === true;
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

function retryReason(error: unknown): LlamaRetryReason {
  if (error instanceof TimeoutError) return 'timeout';
  if (error instanceof HttpError) return 'http';
  if (error instanceof InvalidCompletionError) return 'invalid_completion';
  return 'transport';
}

function notifyProgress(
  request: SelectMoveRequest,
  event: SelectMoveProgressEvent,
): void {
  try {
    void Promise.resolve(request.onProgress?.(event)).catch(() => undefined);
  } catch {
    // Observers are diagnostic only and cannot change move selection.
  }
}
