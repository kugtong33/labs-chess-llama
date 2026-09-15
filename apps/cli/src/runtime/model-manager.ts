import { access, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { DockerCliAdapter } from './docker.js';
import { downloadVerified, sha256File } from './download.js';
import {
  runtimeManifestSchema,
  type DockerAdapter,
  type DockerResult,
  type HealthFetcher,
  type RuntimeManifest,
  type RuntimeProfile,
} from './types.js';

export type { DockerAdapter, HealthFetcher, RuntimeManifest } from './types.js';

export interface ModelManagerOptions {
  manifest: RuntimeManifest;
  paths: { modelDir: string; composeFile: string };
  docker?: DockerAdapter;
  fetch?: HealthFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  healthTimeoutMs?: number;
  healthIntervalMs?: number;
  port?: number;
  now?: () => number;
}

export interface ModelStatus {
  containerState: 'running' | 'stopped' | 'unknown';
  healthy: boolean;
  modelId?: string;
  profileId?: string;
  port: number;
}

export class ModelManager {
  readonly #manifest: RuntimeManifest;
  readonly #modelDir: string;
  readonly #composeFile: string;
  readonly #docker: DockerAdapter;
  readonly #fetch: HealthFetcher;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #healthTimeoutMs: number;
  readonly #healthIntervalMs: number;
  readonly #port: number;
  readonly #now: () => number;
  #activeProfile: RuntimeProfile | undefined;

  public constructor(options: ModelManagerOptions) {
    this.#manifest = runtimeManifestSchema.parse(options.manifest);
    this.#modelDir = options.paths.modelDir;
    this.#composeFile = options.paths.composeFile;
    this.#docker = options.docker ?? new DockerCliAdapter();
    this.#fetch = options.fetch ?? fetch;
    this.#sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#healthTimeoutMs = options.healthTimeoutMs ?? 120_000;
    this.#healthIntervalMs = options.healthIntervalMs ?? 1_000;
    this.#port = options.port ?? 8080;
    this.#now = options.now ?? Date.now;
  }

  public async pull(profileId: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const profile = this.#profile(profileId);
    await mkdir(this.#modelDir, { recursive: true });
    const destination = this.#modelPath(profile);
    await this.#runCompose(['pull', 'llama'], profile, signal);
    if (await exists(destination)) {
      if ((await sha256File(destination, signal)) === profile.sha256)
        return destination;
      await rename(destination, `${destination}.invalid-${this.#now()}`);
    }
    await downloadVerified(
      profile.url,
      destination,
      profile.sha256,
      this.#fetch,
      signal,
    );
    return destination;
  }

  public async start(profileId: string, signal?: AbortSignal): Promise<void> {
    const profile = this.#profile(profileId);
    await this.#verifyInstalled(profile, signal);
    await this.#runCompose(
      ['up', '-d', '--force-recreate', 'llama'],
      profile,
      signal,
    );
    const controller = new AbortController();
    const timeoutMessage = `llama.cpp did not become healthy within ${this.#healthTimeoutMs}ms`;
    const timeout = setTimeout(
      () => controller.abort(new Error(timeoutMessage)),
      this.#healthTimeoutMs,
    );
    const startupSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      await this.#waitForHealth(startupSignal);
      const modelId = await this.#modelId(startupSignal);
      if (modelId !== profile.file) {
        throw new Error(
          `llama.cpp loaded ${modelId ?? 'no model'}, expected ${profile.file}`,
        );
      }
      this.#activeProfile = profile;
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      if (controller.signal.aborted) {
        throw new Error(timeoutMessage, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async stop(): Promise<void> {
    const result = await this.#docker.compose(
      ['rm', '-s', '-f', 'llama'],
      this.#environment(this.#activeProfile),
    );
    assertSuccess(result, 'stop llama.cpp');
    this.#activeProfile = undefined;
  }

  public logs(): Promise<DockerResult> {
    return this.#docker.compose(
      ['logs', 'llama'],
      this.#environment(this.#activeProfile),
    );
  }

  public async status(): Promise<ModelStatus> {
    const container = await this.#docker.compose(
      ['ps', '--status', 'running', '--format', 'json', 'llama'],
      this.#environment(this.#activeProfile),
    );
    let healthy = false;
    let modelId: string | undefined;
    if (container.exitCode === 0 && container.stdout.trim() !== '') {
      try {
        const signal = AbortSignal.timeout(
          Math.min(this.#healthTimeoutMs, 5_000),
        );
        healthy = (await this.#request('/v1/health', signal)).ok;
        if (healthy) modelId = await this.#modelId(signal);
      } catch {
        healthy = false;
      }
    }
    const profile = this.#manifest.profiles.find(
      (item) => item.file === modelId,
    );
    return {
      containerState:
        container.exitCode !== 0
          ? 'unknown'
          : container.stdout.trim() === ''
            ? 'stopped'
            : 'running',
      healthy,
      modelId,
      profileId: profile?.id ?? this.#activeProfile?.id,
      port: this.#port,
    };
  }

  #profile(profileId: string): RuntimeProfile {
    const profile = this.#manifest.profiles.find(
      (item) => item.id === profileId,
    );
    if (!profile) throw new Error(`Unknown model profile: ${profileId}`);
    return profile;
  }

  #modelPath(profile: RuntimeProfile): string {
    return join(this.#modelDir, profile.file);
  }

  async #verifyInstalled(
    profile: RuntimeProfile,
    signal?: AbortSignal,
  ): Promise<void> {
    const path = this.#modelPath(profile);
    if (!(await exists(path))) {
      throw new Error(`Model is not installed: run model pull ${profile.id}`);
    }
    if ((await sha256File(path, signal)) !== profile.sha256) {
      throw new Error(`Installed model checksum mismatch: ${profile.file}`);
    }
  }

  async #runCompose(
    args: readonly string[],
    profile: RuntimeProfile,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.#docker.compose(
      args,
      this.#environment(profile),
      signal,
    );
    assertSuccess(result, `docker compose ${args.join(' ')}`);
  }

  #environment(profile = this.#manifest.profiles[0]): Record<string, string> {
    return {
      CHESS_LLAMA_COMPOSE_FILE: this.#composeFile,
      CHESS_LLAMA_IMAGE: this.#manifest.image,
      CHESS_LLAMA_MODEL_DIR: this.#modelDir,
      CHESS_LLAMA_MODEL_FILE: profile?.file ?? '',
      CHESS_LLAMA_MODEL_PORT: String(this.#port),
      CHESS_LLAMA_PORT_BINDING: `127.0.0.1:${this.#port}:8080`,
      CHESS_LLAMA_GPU_REQUEST: '--gpus all',
      CHESS_LLAMA_CONTAINER: 'chess-llama-model',
    };
  }

  async #waitForHealth(signal: AbortSignal): Promise<void> {
    const attempts = Math.max(
      1,
      Math.ceil(this.#healthTimeoutMs / this.#healthIntervalMs),
    );
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if ((await this.#request('/v1/health', signal)).ok) return;
      } catch {
        if (signal.aborted) throw abortError(signal);
        // The server may still be starting.
      }
      if (attempt + 1 < attempts) {
        await raceWithAbort(this.#sleep(this.#healthIntervalMs), signal);
      }
    }
    throw new Error(
      `llama.cpp did not become healthy within ${this.#healthTimeoutMs}ms`,
    );
  }

  async #modelId(signal: AbortSignal): Promise<string | undefined> {
    const response = await this.#request('/v1/models', signal);
    if (!response.ok)
      throw new Error(`/v1/models returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.data)) return undefined;
    const first: unknown = body.data[0];
    return isRecord(first) && typeof first.id === 'string'
      ? first.id
      : undefined;
  }

  #url(path: string): string {
    return `http://127.0.0.1:${this.#port}${path}`;
  }

  #request(path: string, signal: AbortSignal): Promise<Response> {
    return raceWithAbort(this.#fetch(this.#url(path), { signal }), signal);
  }
}

function assertSuccess(result: DockerResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${action} failed (${result.exitCode}): ${result.stderr}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(asError(error));
      },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return asError(signal.reason, 'Operation aborted');
}

function asError(value: unknown, fallback = 'Operation failed'): Error {
  return value instanceof Error ? value : new Error(fallback, { cause: value });
}
