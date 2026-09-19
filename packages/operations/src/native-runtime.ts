import { execFile, spawn as spawnChild } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { withOperationLock } from './host-runtime.js';

export interface NativeRuntimeState {
  schemaVersion: 1;
  provider: 'native-metal';
  pid: number;
  executable: string;
  modelPath: string;
  modelId: string;
  profileId: string;
  port: number;
  startedAt: string;
  processStartedAt: string;
  logPath: string;
}

export interface NativeRuntimeOptions {
  stateDirectory: string;
  executable: string;
  modelPath: string;
  modelId: string;
  profileId: string;
  contextSize: number;
  port: number;
}

export interface ProcessIdentity {
  command: string;
  startedAt: string;
}

export interface NativeRuntimeDependencies {
  spawn: (
    executable: string,
    arguments_: readonly string[],
    logPath: string,
  ) => Promise<number>;
  inspectProcess: (pid: number) => Promise<ProcessIdentity | undefined>;
  signalProcess: (pid: number, signal: NodeJS.Signals) => void;
  wait: (milliseconds: number) => Promise<void>;
  now: () => Date;
}

export type NativeRuntimeStatus =
  | {
      runtimeState: 'running';
      owned: true;
      state: NativeRuntimeState;
    }
  | {
      runtimeState: 'stopped';
      owned: false;
      state?: NativeRuntimeState;
    }
  | {
      runtimeState: 'unknown';
      owned: false;
      state?: NativeRuntimeState;
      reason?: string;
    };

export interface NativeStopResult {
  runtimeState: 'stopped';
  stopped: boolean;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const execFileAsync = promisify(execFile);

export async function startNativeRuntime(
  options: NativeRuntimeOptions,
  dependencies: NativeRuntimeDependencies = defaultDependencies(),
): Promise<NativeRuntimeState> {
  validateOptions(options);
  await mkdir(options.stateDirectory, { recursive: true });
  return await withOperationLock(
    join(options.stateDirectory, 'model.lock'),
    async () => {
      const existing = await nativeRuntimeStatus(
        options.stateDirectory,
        dependencies,
      );
      if (existing.runtimeState === 'unknown') {
        throw new Error(
          existing.reason ?? 'Existing native runtime ownership is unknown',
        );
      }
      if (existing.runtimeState === 'running') {
        await stopOwnedRuntime(existing.state, dependencies);
      }
      await removeState(options.stateDirectory);

      const logPath = join(options.stateDirectory, 'llama-server.log');
      const arguments_ = nativeServerArguments(options);
      const pid = await dependencies.spawn(
        options.executable,
        arguments_,
        logPath,
      );
      const identity = await waitForProcessIdentity(pid, dependencies);
      if (identity === undefined) {
        throw new Error(`llama-server exited before ownership was recorded`);
      }

      const state: NativeRuntimeState = {
        schemaVersion: 1,
        provider: 'native-metal',
        pid,
        executable: options.executable,
        modelPath: options.modelPath,
        modelId: options.modelId,
        profileId: options.profileId,
        port: options.port,
        startedAt: dependencies.now().toISOString(),
        processStartedAt: identity.startedAt,
        logPath,
      };
      if (!matchesOwnedProcess(state, identity)) {
        throw new Error(
          `Started PID ${pid} does not match the requested llama-server command`,
        );
      }
      await writeState(options.stateDirectory, state);
      return state;
    },
  );
}

export async function nativeRuntimeStatus(
  stateDirectory: string,
  dependencies: NativeRuntimeDependencies = defaultDependencies(),
): Promise<NativeRuntimeStatus> {
  const state = await readState(stateDirectory);
  if (state === undefined) return { runtimeState: 'stopped', owned: false };
  if (state instanceof Error) {
    return {
      runtimeState: 'unknown',
      owned: false,
      reason: state.message,
    };
  }
  const identity = await dependencies.inspectProcess(state.pid);
  if (identity === undefined) {
    return { runtimeState: 'stopped', owned: false, state };
  }
  if (!matchesOwnedProcess(state, identity)) {
    return {
      runtimeState: 'unknown',
      owned: false,
      state,
      reason: `Native runtime state does not match PID ${state.pid}; refusing to signal PID ${state.pid}`,
    };
  }
  return { runtimeState: 'running', owned: true, state };
}

export async function stopNativeRuntime(
  stateDirectory: string,
  dependencies: NativeRuntimeDependencies = defaultDependencies(),
): Promise<NativeStopResult> {
  await mkdir(stateDirectory, { recursive: true });
  return await withOperationLock(
    join(stateDirectory, 'model.lock'),
    async () => {
      const status = await nativeRuntimeStatus(stateDirectory, dependencies);
      if (status.runtimeState === 'unknown') {
        throw new Error(
          status.reason ?? 'Native runtime ownership could not be verified',
        );
      }
      if (status.runtimeState === 'stopped') {
        await removeState(stateDirectory);
        return { runtimeState: 'stopped', stopped: false };
      }
      await stopOwnedRuntime(status.state, dependencies);
      await removeState(stateDirectory);
      return { runtimeState: 'stopped', stopped: true };
    },
  );
}

export async function nativeRuntimeLogs(
  stateDirectory: string,
): Promise<CommandResult> {
  const logPath = join(stateDirectory, 'llama-server.log');
  let stdout = '';
  try {
    stdout = await readFile(logPath, 'utf8');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
  return {
    exitCode: 0,
    stdout: stdout.replace(/\r?\n$/u, ''),
    stderr: '',
  };
}

export function nativeServerArguments(
  options: NativeRuntimeOptions,
): readonly string[] {
  return [
    '--model',
    options.modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(options.port),
    '--ctx-size',
    String(options.contextSize),
    '--n-gpu-layers',
    'all',
    '--flash-attn',
    'auto',
    '--parallel',
    '1',
    '--alias',
    options.profileId,
    '--no-webui',
  ];
}

async function stopOwnedRuntime(
  state: NativeRuntimeState,
  dependencies: NativeRuntimeDependencies,
): Promise<void> {
  dependencies.signalProcess(state.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await dependencies.wait(100);
    if ((await dependencies.inspectProcess(state.pid)) === undefined) return;
  }
  const identity = await dependencies.inspectProcess(state.pid);
  if (identity === undefined) return;
  if (!matchesOwnedProcess(state, identity)) {
    throw new Error(
      `Native runtime identity changed while stopping; refusing to signal PID ${state.pid}`,
    );
  }
  dependencies.signalProcess(state.pid, 'SIGKILL');
}

async function waitForProcessIdentity(
  pid: number,
  dependencies: NativeRuntimeDependencies,
): Promise<ProcessIdentity | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const identity = await dependencies.inspectProcess(pid);
    if (identity !== undefined) return identity;
    await dependencies.wait(25);
  }
  return undefined;
}

function matchesOwnedProcess(
  state: NativeRuntimeState,
  identity: ProcessIdentity,
): boolean {
  const executable = basename(state.executable);
  return (
    identity.startedAt === state.processStartedAt &&
    identity.command.includes(executable) &&
    identity.command.includes(state.modelPath) &&
    identity.command.includes(state.profileId)
  );
}

async function readState(
  stateDirectory: string,
): Promise<NativeRuntimeState | Error | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(stateDirectory, 'runtime.json'), 'utf8'),
    );
    if (!isNativeRuntimeState(value)) {
      return new Error('Native runtime state is invalid; refusing ownership');
    }
    return value;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function writeState(
  stateDirectory: string,
  state: NativeRuntimeState,
): Promise<void> {
  const temporary = join(stateDirectory, `.runtime-${process.pid}.json`);
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: 'wx' });
  await rename(temporary, join(stateDirectory, 'runtime.json'));
}

async function removeState(stateDirectory: string): Promise<void> {
  await rm(join(stateDirectory, 'runtime.json'), { force: true });
}

function isNativeRuntimeState(value: unknown): value is NativeRuntimeState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<NativeRuntimeState>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.provider === 'native-metal' &&
    typeof candidate.pid === 'number' &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.executable === 'string' &&
    typeof candidate.modelPath === 'string' &&
    typeof candidate.modelId === 'string' &&
    typeof candidate.profileId === 'string' &&
    typeof candidate.port === 'number' &&
    Number.isInteger(candidate.port) &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.processStartedAt === 'string' &&
    typeof candidate.logPath === 'string'
  );
}

function validateOptions(options: NativeRuntimeOptions): void {
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error('Native runtime port must be between 1 and 65535');
  }
  if (!Number.isInteger(options.contextSize) || options.contextSize < 1) {
    throw new Error('Native runtime context size must be a positive integer');
  }
}

function defaultDependencies(): NativeRuntimeDependencies {
  return {
    spawn: spawnDetached,
    inspectProcess,
    signalProcess: (pid, signal) => process.kill(-pid, signal),
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => new Date(),
  };
}

async function spawnDetached(
  executable: string,
  arguments_: readonly string[],
  logPath: string,
): Promise<number> {
  const log = openSync(logPath, 'a');
  try {
    const child = spawnChild(executable, arguments_, {
      detached: true,
      stdio: ['ignore', log, log],
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (child.pid === undefined) throw new Error('llama-server has no PID');
    child.unref();
    return child.pid;
  } finally {
    closeSync(log);
  }
}

async function inspectProcess(
  pid: number,
): Promise<ProcessIdentity | undefined> {
  try {
    const [started, command] = await Promise.all([
      execFileAsync('ps', ['-p', String(pid), '-o', 'lstart=']),
      execFileAsync('ps', ['-p', String(pid), '-o', 'command=']),
    ]);
    const startedAt = started.stdout.trim();
    const commandLine = command.stdout.trim();
    if (!startedAt || !commandLine) return undefined;
    return { command: commandLine, startedAt };
  } catch (error) {
    if (
      isNodeError(error) &&
      typeof error.code === 'number' &&
      error.code === 1
    ) {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  const stateDirectory = process.argv[3];
  if (!stateDirectory)
    throw new Error(`${operation ?? 'operation'} requires a state directory`);
  if (operation === 'start') {
    const [executable, modelPath, modelId, profileId, port, contextSize] =
      process.argv.slice(4);
    if (!executable || !modelPath || !modelId || !profileId) {
      throw new Error(
        'start requires executable, model path, model ID, profile ID, port, and context size',
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        await startNativeRuntime({
          stateDirectory,
          executable,
          modelPath,
          modelId,
          profileId,
          port: Number(port),
          contextSize: Number(contextSize),
        }),
      )}\n`,
    );
    return;
  }
  if (operation === 'status') {
    process.stdout.write(
      `${JSON.stringify(await nativeRuntimeStatus(stateDirectory))}\n`,
    );
    return;
  }
  if (operation === 'stop') {
    process.stdout.write(
      `${JSON.stringify(await stopNativeRuntime(stateDirectory))}\n`,
    );
    return;
  }
  if (operation === 'logs') {
    process.stdout.write(
      `${JSON.stringify(await nativeRuntimeLogs(stateDirectory))}\n`,
    );
    return;
  }
  throw new Error(`Unknown native runtime operation: ${operation ?? ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
