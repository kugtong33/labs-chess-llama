import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  nativeRuntimeLogs,
  nativeRuntimeStatus,
  startNativeRuntime,
  stopNativeRuntime,
  type NativeRuntimeDependencies,
  type NativeRuntimeState,
} from './native-runtime.js';

const processIdentity = {
  command:
    '/opt/homebrew/bin/llama-server --model /models/qwen.gguf --alias credible',
  startedAt: 'Sat Sep 19 22:00:00 2026',
};

const options = (stateDirectory: string) => ({
  stateDirectory,
  executable: '/opt/homebrew/bin/llama-server',
  modelPath: '/models/qwen.gguf',
  modelId: 'Qwen3-4B-Q4_K_M.gguf',
  profileId: 'credible',
  contextSize: 4096,
  port: 8080,
});

const dependencies = (
  overrides: Partial<NativeRuntimeDependencies> = {},
): NativeRuntimeDependencies => ({
  spawn: () => Promise.resolve(4312),
  inspectProcess: () => Promise.resolve(processIdentity),
  signalProcess: () => undefined,
  wait: () => Promise.resolve(),
  now: () => new Date('2026-09-19T14:00:00.000Z'),
  ...overrides,
});

describe('native Metal runtime lifecycle', () => {
  it('starts llama-server with loopback-only Metal arguments and persists ownership', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'chess-llama-native-'));
    let invocation:
      | { executable: string; arguments_: readonly string[]; logPath: string }
      | undefined;

    const state = await startNativeRuntime(
      options(stateDirectory),
      dependencies({
        spawn: (executable, arguments_, logPath) => {
          invocation = { executable, arguments_, logPath };
          return Promise.resolve(4312);
        },
      }),
    );

    expect(invocation).toEqual({
      executable: '/opt/homebrew/bin/llama-server',
      arguments_: [
        '--model',
        '/models/qwen.gguf',
        '--host',
        '127.0.0.1',
        '--port',
        '8080',
        '--ctx-size',
        '4096',
        '--n-gpu-layers',
        'all',
        '--flash-attn',
        'auto',
        '--parallel',
        '1',
        '--alias',
        'credible',
        '--no-webui',
      ],
      logPath: join(stateDirectory, 'llama-server.log'),
    });
    expect(state).toMatchObject({
      schemaVersion: 1,
      pid: 4312,
      provider: 'native-metal',
      profileId: 'credible',
      processStartedAt: processIdentity.startedAt,
    });
    expect(
      JSON.parse(await readFile(join(stateDirectory, 'runtime.json'), 'utf8')),
    ).toEqual(state);
  });

  it('reports and stops only a process whose command and start identity match', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'chess-llama-native-'));
    const state = await writeState(stateDirectory);
    const signals: NodeJS.Signals[] = [];
    let running = true;
    const deps = dependencies({
      inspectProcess: () =>
        Promise.resolve(running ? processIdentity : undefined),
      signalProcess: (_pid, signal) => {
        signals.push(signal);
        running = false;
      },
    });

    await expect(nativeRuntimeStatus(stateDirectory, deps)).resolves.toEqual({
      runtimeState: 'running',
      owned: true,
      state,
    });
    await expect(stopNativeRuntime(stateDirectory, deps)).resolves.toEqual({
      runtimeState: 'stopped',
      stopped: true,
    });
    expect(signals).toEqual(['SIGTERM']);
    await expect(
      readFile(join(stateDirectory, 'runtime.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans stale state without signalling a dead process', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'chess-llama-native-'));
    await writeState(stateDirectory);
    const signals: NodeJS.Signals[] = [];
    const deps = dependencies({
      inspectProcess: () => Promise.resolve(undefined),
      signalProcess: (_pid, signal) => signals.push(signal),
    });

    await expect(stopNativeRuntime(stateDirectory, deps)).resolves.toEqual({
      runtimeState: 'stopped',
      stopped: false,
    });
    expect(signals).toEqual([]);
  });

  it('refuses to signal a reused PID whose process identity does not match', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'chess-llama-native-'));
    await writeState(stateDirectory);
    const signals: NodeJS.Signals[] = [];
    const deps = dependencies({
      inspectProcess: () =>
        Promise.resolve({
          command: '/usr/bin/unrelated-worker',
          startedAt: 'Sat Sep 19 22:01:00 2026',
        }),
      signalProcess: (_pid, signal) => signals.push(signal),
    });

    await expect(
      nativeRuntimeStatus(stateDirectory, deps),
    ).resolves.toMatchObject({
      runtimeState: 'unknown',
      owned: false,
    });
    await expect(stopNativeRuntime(stateDirectory, deps)).rejects.toThrow(
      'refusing to signal PID 4312',
    );
    expect(signals).toEqual([]);
  });

  it('returns native logs in the established command-result envelope', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'chess-llama-native-'));
    await writeFile(
      join(stateDirectory, 'llama-server.log'),
      'Metal device loaded\nserver ready\n',
    );

    await expect(nativeRuntimeLogs(stateDirectory)).resolves.toEqual({
      exitCode: 0,
      stdout: 'Metal device loaded\nserver ready',
      stderr: '',
    });
  });
});

async function writeState(stateDirectory: string): Promise<NativeRuntimeState> {
  const state: NativeRuntimeState = {
    schemaVersion: 1,
    provider: 'native-metal',
    pid: 4312,
    executable: '/opt/homebrew/bin/llama-server',
    modelPath: '/models/qwen.gguf',
    modelId: 'Qwen3-4B-Q4_K_M.gguf',
    profileId: 'credible',
    port: 8080,
    startedAt: '2026-09-19T14:00:00.000Z',
    processStartedAt: processIdentity.startedAt,
    logPath: join(stateDirectory, 'llama-server.log'),
  };
  await writeFile(
    join(stateDirectory, 'runtime.json'),
    `${JSON.stringify(state)}\n`,
  );
  return state;
}
