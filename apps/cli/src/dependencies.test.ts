import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createDefaultDependencies,
  createSystemProcessRunner,
  type ModelDependencies,
  type ProcessRunner,
} from './dependencies.js';

describe('default CLI dependencies', () => {
  it('runs a real child process with an AbortSignal', async () => {
    const runner = createSystemProcessRunner();
    const result = await runner.run(
      '/usr/bin/printf',
      ['ok'],
      new AbortController().signal,
    );

    expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' });
  });

  it('launches the gateway with the resolved persistent database path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chess-llama-gateway-env-'));
    const databaseFile = join(root, 'data', 'chess-llama.sqlite');
    const launches: Array<{
      command: string;
      environment?: Record<string, string>;
    }> = [];
    const dependencies = await createDefaultDependencies(
      {
        configFile: join(root, 'config', 'config.json'),
        databaseFile,
        backupsDir: join(root, 'data', 'backups'),
        benchmarksDir: join(root, 'data', 'benchmarks'),
        modelDir: join(root, 'cache', 'models'),
        composeFile: join(root, 'compose.yaml'),
      },
      {
        runner: {
          run(command, _args, _signal, environment) {
            launches.push({ command, environment });
            return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
          },
        },
      },
    );

    await dependencies.gateway.dev();
    await dependencies.gateway.start();

    expect(launches).toEqual([
      {
        command: 'pnpm',
        environment: {
          DATABASE_PATH: databaseFile,
          LLAMA_BASE_URL: 'http://127.0.0.1:8080',
          CLIENT_ORIGIN: 'http://127.0.0.1:5173',
        },
      },
      {
        command: 'node',
        environment: {
          DATABASE_PATH: databaseFile,
          LLAMA_BASE_URL: 'http://127.0.0.1:8080',
          CLIENT_ORIGIN: 'http://127.0.0.1:5173',
        },
      },
    ]);
  });

  it('runs every doctor check with the pinned GPU image and separates prerequisites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chess-llama-doctor-'));
    const modelDir = join(root, 'cache', 'models');
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, 'Qwen3-4B-Q4_K_M.gguf'), 'installed');
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: ProcessRunner = {
      run(command, args) {
        calls.push({ command, args });
        return Promise.resolve({
          exitCode: 0,
          stdout: command === 'pnpm' ? '11.5.1' : 'ok',
          stderr: '',
        });
      },
    };
    const model: ModelDependencies = {
      pull: () => Promise.resolve(),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      status: () =>
        Promise.resolve({ healthy: false, containerState: 'stopped' }),
      logs: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    };
    const dependencies = await createDefaultDependencies(
      {
        configFile: join(root, 'config', 'config.json'),
        databaseFile: join(root, 'data', 'chess-llama.sqlite'),
        backupsDir: join(root, 'data', 'backups'),
        benchmarksDir: join(root, 'data', 'benchmarks'),
        modelDir,
        composeFile: join(root, 'compose.yaml'),
      },
      {
        runner,
        model,
        portOpen: () => Promise.resolve(false),
        fetch: () => Promise.resolve(new Response(null, { status: 503 })),
        hashFile: () =>
          Promise.resolve(
            '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
          ),
      },
    );

    const report = await dependencies.doctor();

    expect(report.prerequisitesOk).toBe(true);
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.name === 'model-health')?.ok,
    ).toBe(false);
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        'node',
        'pnpm',
        'docker',
        'compose',
        'nvidia',
        'port:5173',
        'port:3001',
        'port:8080',
        'migration',
        'model-installed',
        'model-health',
        'gateway-health',
      ]),
    );
    const gpu = calls.find(
      (call) => call.command === 'docker' && call.args[0] === 'run',
    );
    expect(gpu?.args.join(' ')).toContain('--gpus all');
    expect(gpu?.args.join(' ')).toContain('--pull never');
    expect(gpu?.args.join(' ')).toContain('--entrypoint nvidia-smi');
    expect(gpu?.args.join(' ')).toMatch(
      /ghcr\.io\/ggml-org\/llama\.cpp@sha256:[a-f0-9]{64}/u,
    );
  });

  it('rejects an unpinned pnpm and an installed model with the wrong checksum', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chess-llama-doctor-invalid-'));
    const modelDir = join(root, 'cache', 'models');
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(modelDir, 'Qwen3-4B-Q4_K_M.gguf'), 'corrupt');
    const model: ModelDependencies = {
      pull: () => Promise.resolve(),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      status: () =>
        Promise.resolve({ healthy: false, containerState: 'stopped' }),
      logs: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    };
    const dependencies = await createDefaultDependencies(
      {
        configFile: join(root, 'config', 'config.json'),
        databaseFile: join(root, 'data', 'chess-llama.sqlite'),
        backupsDir: join(root, 'data', 'backups'),
        benchmarksDir: join(root, 'data', 'benchmarks'),
        modelDir,
        composeFile: join(root, 'compose.yaml'),
      },
      {
        runner: {
          run: (command) =>
            Promise.resolve({
              exitCode: 0,
              stdout: command === 'pnpm' ? '10.0.0' : 'ok',
              stderr: '',
            }),
        },
        model,
        portOpen: () => Promise.resolve(false),
        fetch: () => Promise.resolve(new Response(null, { status: 503 })),
        hashFile: () => Promise.resolve('0'.repeat(64)),
      },
    );

    const report = await dependencies.doctor();

    expect(report.prerequisitesOk).toBe(false);
    expect(report.checks.find((check) => check.name === 'pnpm')?.ok).toBe(
      false,
    );
    expect(
      report.checks.find((check) => check.name === 'model-installed')?.ok,
    ).toBe(false);
  });
});
