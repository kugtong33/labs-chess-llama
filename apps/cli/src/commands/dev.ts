import type { CliDependencies, DoctorReport } from '../dependencies.js';

export interface DevDependencies {
  signal: AbortSignal;
  doctor(): Promise<DoctorReport>;
  migrate(): Promise<void>;
  isModelRunning?(): Promise<boolean>;
  startModel(): Promise<unknown>;
  stopModel(): Promise<unknown>;
  isGatewayRunning?(): Promise<boolean>;
  startGateway(): Promise<unknown>;
  stopGateway(): Promise<unknown>;
  isClientRunning?(): Promise<boolean>;
  startClient(): Promise<unknown>;
  stopClient(): Promise<unknown>;
}

export async function runDev(dependencies: DevDependencies): Promise<number> {
  const report = await dependencies.doctor();
  if (!(report.prerequisitesOk ?? report.ok)) return 3;
  if (dependencies.signal.aborted) return 0;
  let modelOwned = false;
  let gatewayOwned = false;
  let clientOwned = false;
  let failure: unknown;
  let stage: 'migration' | 'model' | 'children' = 'migration';
  try {
    await dependencies.migrate();
    if (dependencies.signal.aborted) return 0;
    stage = 'model';
    const modelRunning = await dependencies.isModelRunning?.();
    if (dependencies.signal.aborted) return 0;
    if (!modelRunning) {
      modelOwned = true;
      await dependencies.startModel();
    }
    if (dependencies.signal.aborted) return 0;

    stage = 'children';
    const children: Promise<unknown>[] = [];
    const gatewayRunning = await dependencies.isGatewayRunning?.();
    if (dependencies.signal.aborted) return 0;
    if (!gatewayRunning) {
      gatewayOwned = true;
      children.push(
        supervise(dependencies.startGateway(), dependencies.signal),
      );
    }
    const clientRunning = await dependencies.isClientRunning?.();
    if (dependencies.signal.aborted) return 0;
    if (!clientRunning) {
      clientOwned = true;
      children.push(supervise(dependencies.startClient(), dependencies.signal));
    }
    if (!dependencies.signal.aborted) {
      failure = await Promise.race([
        waitForAbort(dependencies.signal).then(() => undefined),
        ...children,
      ]);
    }
  } catch (error) {
    failure = dependencies.signal.aborted
      ? undefined
      : stageFailure(error, stage);
  } finally {
    if (clientOwned)
      await safelyStop(
        () => dependencies.stopClient(),
        (error) => (failure ??= error),
      );
    if (gatewayOwned)
      await safelyStop(
        () => dependencies.stopGateway(),
        (error) => (failure ??= error),
      );
    if (modelOwned)
      await safelyStop(
        () => dependencies.stopModel(),
        (error) => (failure ??= error),
      );
  }
  return childExitCode(failure);
}

function stageFailure(
  error: unknown,
  stage: 'migration' | 'model' | 'children',
): unknown {
  if (stage === 'migration') return { exitCode: 6, cause: error };
  if (stage === 'model') {
    const message = error instanceof Error ? error.message : '';
    return {
      exitCode: /health|\/v1\/models|loaded .* expected/iu.test(message)
        ? 5
        : 4,
      cause: error,
    };
  }
  return error;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );
}

function supervise(
  child: Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  return child.then(
    (result) => {
      if (
        result &&
        typeof result === 'object' &&
        'exitCode' in result &&
        typeof result.exitCode === 'number' &&
        result.exitCode !== 0
      ) {
        return result;
      }
      return undefined;
    },
    (error: unknown) => (signal.aborted ? undefined : error),
  );
}

async function safelyStop(
  stop: () => Promise<unknown>,
  record: (error: unknown) => void,
): Promise<void> {
  try {
    await stop();
  } catch (error) {
    record(error);
  }
}

function childExitCode(error: unknown): number {
  if (
    error &&
    typeof error === 'object' &&
    'exitCode' in error &&
    typeof error.exitCode === 'number'
  )
    return error.exitCode;
  return error === undefined ? 0 : 1;
}

export function devDependencies(
  dependencies: CliDependencies,
): DevDependencies {
  return {
    signal: dependencies.signal ?? new AbortController().signal,
    doctor: async () => dependencies.doctor(dependencies.signal),
    migrate: () => dependencies.database.migrate(),
    isModelRunning: async () => {
      try {
        return isRunningStatus(await dependencies.model.status());
      } catch {
        return false;
      }
    },
    startModel: async () => {
      const profile =
        (await dependencies.preferredProfile?.()) ??
        dependencies.defaultProfile ??
        'qwen3-4b-q4-k-m';
      await dependencies.model.start(profile, dependencies.signal);
    },
    stopModel: () => dependencies.model.stop(),
    isGatewayRunning: () =>
      dependencies.gateway.isRunning?.() ?? Promise.resolve(false),
    startGateway: () => dependencies.gateway.start(dependencies.signal),
    stopGateway: () => dependencies.gateway.stop(),
    isClientRunning: () =>
      dependencies.client.isRunning?.() ?? Promise.resolve(false),
    startClient: () => dependencies.client.dev(dependencies.signal),
    stopClient: () => dependencies.client.stop(),
  };
}

function isRunningStatus(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'healthy' in value &&
    value.healthy === true
  );
}
