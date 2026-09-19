import type { z } from 'zod';
import {
  AiMoveRequestSchema,
  AiDecisionViewSchema,
  CreateGameRequestSchema,
  GameListResponseSchema,
  GameViewSchema,
  HealthResponseSchema,
  ProblemDetailsSchema,
  ResignRequestSchema,
  SettingsSchema,
  SubmitMoveRequestSchema,
  UpdateSettingsRequestSchema,
  type AiMoveRequest,
  type AiDecisionView,
  type CreateGameRequest,
  type GameListResponse,
  type GameView,
  type HealthResponse,
  type ProblemDetails,
  type ResignRequest,
  type Settings,
  type SubmitMoveRequest,
  type UpdateSettingsRequest,
} from '@chess-llama/contracts';

export class BackendConnectionError extends Error {
  public constructor(
    message = 'Unable to connect to the chess-llama backend',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BackendConnectionError';
  }
}

export class BackendResponseError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackendResponseError';
  }
}

export class BackendProblemError extends Error implements ProblemDetails {
  public readonly type: string;
  public readonly title: string;
  public readonly status: number;
  public readonly detail: string;
  public readonly requestId: string;
  public readonly gameId?: string;
  public readonly gameStatus?: ProblemDetails['gameStatus'];

  public constructor(problem: ProblemDetails) {
    super(problem.detail);
    this.name = 'BackendProblemError';
    this.type = problem.type;
    this.title = problem.title;
    this.status = problem.status;
    this.detail = problem.detail;
    this.requestId = problem.requestId;
    this.gameId = problem.gameId;
    this.gameStatus = problem.gameStatus;
  }
}

export interface PgnDownload {
  blob: Blob;
  filename: string;
}

type Fetcher = typeof fetch;

export interface BackendApi {
  health(signal?: AbortSignal): Promise<HealthResponse>;
  listGames(signal?: AbortSignal): Promise<GameListResponse>;
  getGame(id: string, signal?: AbortSignal): Promise<GameView>;
  getDecisions(id: string, signal?: AbortSignal): Promise<AiDecisionView[]>;
  decisionEventsUrl(id: string): string;
  createGame(
    request?: CreateGameRequest,
    signal?: AbortSignal,
  ): Promise<GameView>;
  submitHumanMove(
    id: string,
    request: SubmitMoveRequest,
    signal?: AbortSignal,
  ): Promise<GameView>;
  retryAiMove(
    id: string,
    request: AiMoveRequest,
    signal?: AbortSignal,
  ): Promise<GameView>;
  resignGame(
    id: string,
    request: ResignRequest,
    signal?: AbortSignal,
  ): Promise<GameView>;
  getSettings(signal?: AbortSignal): Promise<Settings>;
  updateSettings(
    request: UpdateSettingsRequest,
    signal?: AbortSignal,
  ): Promise<Settings>;
  getPgn(id: string, signal?: AbortSignal): Promise<PgnDownload>;
}

export class BackendClient implements BackendApi {
  readonly #baseUrl: string;
  readonly #fetch: Fetcher;

  public constructor(baseUrl: string, fetcher?: Fetcher) {
    this.#baseUrl = baseUrl.replace(/\/+$/u, '');
    this.#fetch = fetcher ?? globalThis.fetch.bind(globalThis);
  }

  public health(signal?: AbortSignal): Promise<HealthResponse> {
    return this.#json('/api/health', HealthResponseSchema, { signal });
  }

  public listGames(signal?: AbortSignal): Promise<GameListResponse> {
    return this.#json('/api/games', GameListResponseSchema, { signal });
  }

  public getGame(id: string, signal?: AbortSignal): Promise<GameView> {
    return this.#json(`/api/games/${encodeURIComponent(id)}`, GameViewSchema, {
      signal,
    });
  }

  public getDecisions(
    id: string,
    signal?: AbortSignal,
  ): Promise<AiDecisionView[]> {
    return this.#json(
      `/api/games/${encodeURIComponent(id)}/decisions`,
      AiDecisionViewSchema.array(),
      { signal },
    );
  }

  public decisionEventsUrl(id: string): string {
    return `${this.#baseUrl}/api/demo/events?gameId=${encodeURIComponent(id)}`;
  }

  public createGame(
    request: CreateGameRequest = {},
    signal?: AbortSignal,
  ): Promise<GameView> {
    return this.#json('/api/games', GameViewSchema, {
      method: 'POST',
      body: JSON.stringify(CreateGameRequestSchema.parse(request)),
      signal,
    });
  }

  public submitHumanMove(
    id: string,
    request: SubmitMoveRequest,
    signal?: AbortSignal,
  ): Promise<GameView> {
    return this.#json(
      `/api/games/${encodeURIComponent(id)}/moves`,
      GameViewSchema,
      {
        method: 'POST',
        body: JSON.stringify(SubmitMoveRequestSchema.parse(request)),
        signal,
      },
    );
  }

  public retryAiMove(
    id: string,
    request: AiMoveRequest,
    signal?: AbortSignal,
  ): Promise<GameView> {
    return this.#json(
      `/api/games/${encodeURIComponent(id)}/moves/ai`,
      GameViewSchema,
      {
        method: 'POST',
        body: JSON.stringify(AiMoveRequestSchema.parse(request)),
        signal,
      },
    );
  }

  public resignGame(
    id: string,
    request: ResignRequest,
    signal?: AbortSignal,
  ): Promise<GameView> {
    return this.#json(
      `/api/games/${encodeURIComponent(id)}/resign`,
      GameViewSchema,
      {
        method: 'POST',
        body: JSON.stringify(ResignRequestSchema.parse(request)),
        signal,
      },
    );
  }

  public getSettings(signal?: AbortSignal): Promise<Settings> {
    return this.#json('/api/settings', SettingsSchema, { signal });
  }

  public updateSettings(
    request: UpdateSettingsRequest,
    signal?: AbortSignal,
  ): Promise<Settings> {
    return this.#json('/api/settings', SettingsSchema, {
      method: 'PUT',
      body: JSON.stringify(UpdateSettingsRequestSchema.parse(request)),
      signal,
    });
  }

  public async getPgn(id: string, signal?: AbortSignal): Promise<PgnDownload> {
    const response = await this.#request(
      `/api/games/${encodeURIComponent(id)}/pgn`,
      { signal },
    );
    if (!response.ok) await throwProblem(response, signal);
    return {
      blob: await readBlob(response, signal),
      filename: pgnFilename(
        response.headers.get('content-disposition'),
        fallbackPgnFilename(id),
      ),
    };
  }

  async #json<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined)
      headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    const response = await this.#request(path, { ...init, headers });
    if (!response.ok) await throwProblem(response, init.signal);
    return schema.parse(await readJson(response, init.signal));
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new BackendConnectionError(undefined, { cause: error });
    }
  }
}

async function throwProblem(
  response: Response,
  signal?: AbortSignal | null,
): Promise<never> {
  const body = await readJson(response, signal);
  const parsed = ProblemDetailsSchema.safeParse(body);
  if (parsed.success) throw new BackendProblemError(parsed.data);
  throw new BackendResponseError(
    `Backend returned HTTP ${response.status} without valid problem details`,
  );
}

async function readJson(
  response: Response,
  signal?: AbortSignal | null,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throwBodyReadError(error, signal, 'Backend returned invalid JSON');
  }
}

async function readBlob(
  response: Response,
  signal?: AbortSignal | null,
): Promise<Blob> {
  try {
    return await response.blob();
  } catch (error) {
    throwBodyReadError(error, signal, 'Backend returned an invalid PGN body');
  }
}

function throwBodyReadError(
  error: unknown,
  signal: AbortSignal | null | undefined,
  invalidMessage: string,
): never {
  if (signal?.aborted) throw signal.reason ?? error;
  if (error instanceof SyntaxError) {
    throw new BackendResponseError(invalidMessage, { cause: error });
  }
  throw new BackendConnectionError(undefined, { cause: error });
}

function pgnFilename(header: string | null, fallback: string): string {
  const match = header?.match(/filename\s*=\s*(?:"([^"]+)"|([^;\s]+))/iu);
  const proposed = match?.[1] ?? match?.[2] ?? fallback;
  const safe = safeFilename(proposed);
  return safe?.toLowerCase().endsWith('.pgn') ? safe : fallback;
}

function fallbackPgnFilename(id: string): string {
  const segment = id.split(/[\\/]/u).at(-1) ?? '';
  const safeId = segment.replace(/[^a-z0-9_-]/giu, '_');
  return `chess-llama-${safeId || 'game'}.pgn`;
}

function safeFilename(value: string): string | undefined {
  return value
    .split(/[\\/]/u)
    .at(-1)
    ?.replace(/[^a-z0-9._-]/giu, '_');
}
