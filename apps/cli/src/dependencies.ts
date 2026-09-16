import { constants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { execa } from 'execa';

import {
  backupDatabase,
  createSettingsRepository,
  getMigrationStatus,
  migrateDatabase,
  openDatabase,
} from '@chess-llama/storage';

import { resolveChessLlamaPaths, type ChessLlamaPaths } from './paths.js';
import { ModelManager } from './runtime/model-manager.js';
import { sha256File } from './runtime/download.js';
import type { DockerResult, RuntimeManifest } from './runtime/types.js';
import {
  runInstalledBenchmarks,
  type BenchmarkDependencies,
} from './commands/benchmark.js';

export interface Output {
  write(value: unknown, format?: 'json' | 'human'): void;
  error(value: unknown): void;
}

export interface ProcessRunner {
  run(
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
    environment?: Readonly<Record<string, string>>,
  ): Promise<DockerResult>;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  requiredForDev?: boolean;
}

export interface DoctorReport {
  ok: boolean;
  prerequisitesOk?: boolean;
  checks: DoctorCheck[];
}

export interface DatabaseDependencies {
  migrate(): Promise<void>;
  status(): Promise<unknown>;
  backup(): Promise<string>;
}

export interface ModelDependencies {
  pull(profile?: string, signal?: AbortSignal): Promise<unknown>;
  start(profile?: string, signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<unknown>;
  status(): Promise<unknown>;
  logs(): Promise<unknown>;
}

export interface GatewayDependencies {
  dev(signal?: AbortSignal): Promise<unknown>;
  start(signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<unknown>;
  health(signal?: AbortSignal): Promise<unknown>;
  isRunning?(): Promise<boolean>;
}

export interface ClientDependencies {
  build(): Promise<unknown>;
  dev(signal?: AbortSignal): Promise<unknown>;
  serve(signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<unknown>;
  isRunning?(): Promise<boolean>;
}

export interface CliDependencies {
  database: DatabaseDependencies;
  model: ModelDependencies;
  gateway: GatewayDependencies;
  client: ClientDependencies;
  doctor(signal?: AbortSignal): Promise<DoctorReport>;
  output?: Output;
  signal?: AbortSignal;
  defaultProfile?: string;
  preferredProfile?: () => Promise<string | undefined>;
  benchmark?: BenchmarkDependencies;
  events?: string[];
}

export interface DefaultDependencyAdapters {
  runner?: ProcessRunner;
  fetch?: typeof fetch;
  model?: ModelDependencies;
  portOpen?: (port: number) => Promise<boolean>;
  hashFile?: (path: string, signal?: AbortSignal) => Promise<string>;
  now?: () => number;
}

const DEFAULT_PROFILE = 'qwen3-4b-q4-k-m';

export async function createDefaultDependencies(
  paths: ChessLlamaPaths = resolveChessLlamaPaths(),
  adapters: DefaultDependencyAdapters = {},
): Promise<CliDependencies> {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../../config/runtime-manifest.json', import.meta.url),
      'utf8',
    ),
  ) as RuntimeManifest;
  const model =
    adapters.model ??
    new ModelManager({
      manifest,
      paths: { modelDir: paths.modelDir, composeFile: paths.composeFile },
    });
  const runner: ProcessRunner = adapters.runner ?? {
    async run(command, args, signal, environment) {
      const result = await execa(command, args, {
        reject: false,
        signal,
        env: environment,
      });
      return {
        exitCode: result.exitCode ?? 1,
        stdout: String(result.stdout),
        stderr: String(result.stderr),
      };
    },
  };
  const database: DatabaseDependencies = {
    async migrate() {
      await mkdir(dirname(paths.databaseFile), { recursive: true });
      const db = openDatabase(paths.databaseFile);
      try {
        migrateDatabase(db);
      } finally {
        db.close();
      }
    },
    async status() {
      await mkdir(dirname(paths.databaseFile), { recursive: true });
      const db = openDatabase(paths.databaseFile);
      try {
        return getMigrationStatus(db);
      } finally {
        db.close();
      }
    },
    async backup() {
      await mkdir(paths.backupsDir, { recursive: true });
      await mkdir(dirname(paths.databaseFile), { recursive: true });
      const db = openDatabase(paths.databaseFile);
      try {
        const destination = `${paths.backupsDir}/chess-llama-${(adapters.now ?? Date.now)()}.sqlite`;
        await backupDatabase(db, destination);
        return destination;
      } finally {
        db.close();
      }
    },
  };
  const run = async (
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
    environment?: Readonly<Record<string, string>>,
  ) => {
    const result = await runner.run(command, args, signal, environment);
    if (result.exitCode !== 0)
      throw Object.assign(new Error(result.stderr || `${command} failed`), {
        exitCode: result.exitCode,
      });
    return result;
  };
  interface ManagedProcess {
    controller: AbortController;
    completion: Promise<DockerResult>;
  }
  let gatewayProcess: ManagedProcess | undefined;
  let clientProcess: ManagedProcess | undefined;
  const launch = (
    kind: 'gateway' | 'client',
    command: string,
    args: readonly string[],
    signal?: AbortSignal,
    environment?: Readonly<Record<string, string>>,
  ): Promise<DockerResult> => {
    const existing = kind === 'gateway' ? gatewayProcess : clientProcess;
    if (existing) return existing.completion;
    const controller = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const managed: ManagedProcess = {
      controller,
      completion: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    };
    managed.completion = run(command, args, combined, environment).finally(
      () => {
        if (kind === 'gateway' && gatewayProcess === managed)
          gatewayProcess = undefined;
        if (kind === 'client' && clientProcess === managed)
          clientProcess = undefined;
      },
    );
    if (kind === 'gateway') gatewayProcess = managed;
    else clientProcess = managed;
    return managed.completion;
  };
  const stopManaged = async (process: ManagedProcess | undefined) => {
    if (!process) return;
    process.controller.abort();
    try {
      await process.completion;
    } catch {
      // Cancellation and an already-failed child are both fully observed here.
    }
  };
  return {
    database,
    model,
    gateway: {
      dev: (signal) =>
        launch(
          'gateway',
          'pnpm',
          ['exec', 'tsx', 'apps/gateway/src/main.ts'],
          signal,
          gatewayEnvironment(paths.databaseFile),
        ),
      start: (signal) =>
        launch(
          'gateway',
          'node',
          ['apps/gateway/dist/main.js'],
          signal,
          gatewayEnvironment(paths.databaseFile),
        ),
      stop: async () => {
        await stopManaged(gatewayProcess);
      },
      health: async (signal) => {
        const response = await (adapters.fetch ?? fetch)(
          'http://127.0.0.1:3001/api/health',
          {
            signal,
          },
        );
        if (!response.ok)
          throw new Error(`Gateway health returned ${response.status}`);
        return response.json();
      },
      isRunning: async () => {
        try {
          const response = await (adapters.fetch ?? fetch)(
            'http://127.0.0.1:3001/api/health',
            { signal: AbortSignal.timeout(1_000) },
          );
          return response.ok;
        } catch {
          return false;
        }
      },
    },
    client: {
      build: () => run('pnpm', ['--filter', '@chess-llama/client', 'build']),
      dev: (signal) =>
        launch(
          'client',
          'pnpm',
          [
            '--filter',
            '@chess-llama/client',
            'dev',
            '--',
            '--host',
            '127.0.0.1',
          ],
          signal,
        ),
      serve: (signal) =>
        launch(
          'client',
          'pnpm',
          [
            '--filter',
            '@chess-llama/client',
            'preview',
            '--',
            '--host',
            '127.0.0.1',
          ],
          signal,
        ),
      stop: async () => {
        await stopManaged(clientProcess);
      },
      isRunning: () => (adapters.portOpen ?? isPortOpen)(5173),
    },
    benchmark: {
      run: (profileIds, signal) =>
        runInstalledBenchmarks({
          paths,
          manifest,
          profileIds,
          signal,
        }),
    },
    defaultProfile: DEFAULT_PROFILE,
    preferredProfile: () => {
      try {
        const db = openDatabase(paths.databaseFile);
        try {
          return Promise.resolve(
            createSettingsRepository(db).get().modelProfileId,
          );
        } finally {
          db.close();
        }
      } catch {
        return Promise.resolve(undefined);
      }
    },
    doctor: async (signal) => {
      const checks: DoctorCheck[] = [];
      const add = (
        name: string,
        ok: boolean,
        detail: string,
        requiredForDev = true,
      ) => checks.push({ name, ok, detail, requiredForDev });
      add(
        'node',
        process.versions.node.startsWith('24.'),
        process.versions.node,
      );
      try {
        const pnpm = await runner.run('pnpm', ['--version'], signal);
        add(
          'pnpm',
          pnpm.exitCode === 0 && pnpm.stdout.trim() === '11.5.1',
          pnpm.stdout.trim() || pnpm.stderr.trim(),
        );
      } catch (error) {
        add('pnpm', false, String(error));
      }
      for (const [name, command, args] of [
        ['docker', 'docker', ['info']],
        ['compose', 'docker', ['compose', 'version']],
        [
          'nvidia',
          'docker',
          [
            'run',
            '--rm',
            '--pull',
            'never',
            '--gpus',
            'all',
            '--entrypoint',
            'nvidia-smi',
            manifest.image,
            '-L',
          ],
        ],
      ] as const) {
        try {
          const result = await runner.run(command, args, signal);
          add(
            name,
            result.exitCode === 0,
            result.stdout.trim() || result.stderr.trim(),
          );
        } catch (error) {
          add(name, false, String(error));
        }
      }
      for (const [name, directory] of [
        ['config', dirname(paths.configFile)],
        ['database', dirname(paths.databaseFile)],
        ['backups', paths.backupsDir],
        ['benchmarks', paths.benchmarksDir],
        ['models', paths.modelDir],
      ] as const) {
        try {
          await mkdir(directory, { recursive: true });
          await access(directory, constants.W_OK);
          add(`xdg:${name}`, true, directory);
        } catch {
          add(`xdg:${name}`, false, `${directory} is not writable`);
        }
      }
      for (const port of [5173, 3001, 8080]) {
        const open = await (adapters.portOpen ?? isPortOpen)(port);
        add(`port:${port}`, !open, open ? 'in use' : 'available', false);
      }
      try {
        const migration = await database.status();
        add(
          'migration',
          isReadyMigration(migration),
          JSON.stringify(migration),
          false,
        );
      } catch (error) {
        add('migration', false, String(error), false);
      }
      try {
        let profileId = DEFAULT_PROFILE;
        const db = openDatabase(paths.databaseFile);
        try {
          try {
            profileId = createSettingsRepository(db).get().modelProfileId;
          } catch {
            // A fresh database is migrated by `dev` after prerequisites pass.
          }
        } finally {
          db.close();
        }
        const profile = manifest.profiles.find((item) => item.id === profileId);
        if (!profile) throw new Error(`Unknown model profile: ${profileId}`);
        const modelPath = join(paths.modelDir, profile.file);
        await access(modelPath);
        const actualSha256 = await (adapters.hashFile ?? sha256File)(
          modelPath,
          signal,
        );
        if (actualSha256 !== profile.sha256) {
          throw new Error(`Installed model checksum mismatch: ${profile.file}`);
        }
        add('model-installed', true, `${profile.file} checksum verified`);
      } catch (error) {
        add('model-installed', false, String(error));
      }
      try {
        const modelStatus = await model.status();
        add(
          'model-health',
          isHealthyModel(modelStatus),
          JSON.stringify(modelStatus),
          false,
        );
      } catch (error) {
        add('model-health', false, String(error), false);
      }
      try {
        const health = await (adapters.fetch ?? fetch)(
          'http://127.0.0.1:3001/api/health',
          { signal },
        );
        add('gateway-health', health.ok, `HTTP ${health.status}`, false);
      } catch (error) {
        add('gateway-health', false, String(error), false);
      }
      const prerequisitesOk = checks
        .filter((check) => check.requiredForDev !== false)
        .every((check) => check.ok);
      return {
        ok: prerequisitesOk,
        prerequisitesOk,
        checks,
      };
    },
  };
}

function gatewayEnvironment(databaseFile: string): Record<string, string> {
  return {
    DATABASE_PATH: databaseFile,
    LLAMA_BASE_URL: 'http://127.0.0.1:8080',
    CLIENT_ORIGIN: 'http://127.0.0.1:5173',
  };
}

function isReadyMigration(value: unknown): boolean {
  return isRecord(value) && value.pending === false;
}

function isHealthyModel(value: unknown): boolean {
  return isRecord(value) && value.healthy === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
