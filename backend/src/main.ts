import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GameService } from './game-service.js';
import { GameLock } from './game-lock.js';
import { parseBackendConfig } from './config.js';
import { buildApp } from './app.js';
import { DecisionTraceHub } from './decision-trace-hub.js';
import { LlamaCppClient } from '@chess-llama/llama-protocol';
import { StockfishJsAnalyzer } from '@chess-llama/stockfish-adapter';
import {
  createGameRepository,
  createSettingsRepository,
  migrateDatabase,
  openDatabase,
} from '@chess-llama/storage';

export interface ShutdownProcess {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  exitCode?: unknown;
}

export interface ShutdownLogger {
  error(error: unknown, signal: string): void;
}

export function installShutdownHandlers(
  processLike: ShutdownProcess,
  app: { close(): Promise<void> },
  logger: ShutdownLogger = console,
): () => void {
  let shutdown: Promise<void> | undefined;
  let removed = false;
  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    if (shutdown) return;
    shutdown = app.close();
    void shutdown.then(
      () => remove(),
      (error) => {
        logger.error(error, signal);
        processLike.exitCode = 1;
        remove();
      },
    );
  };
  const onInterrupt = () => onSignal('SIGINT');
  const onTerminate = () => onSignal('SIGTERM');
  const remove = () => {
    if (removed) return;
    removed = true;
    processLike.removeListener('SIGINT', onInterrupt);
    processLike.removeListener('SIGTERM', onTerminate);
  };
  processLike.once('SIGINT', onInterrupt);
  processLike.once('SIGTERM', onTerminate);
  return remove;
}

export interface ClosableDatabase {
  open: boolean;
  close(): void;
}

export interface ClosableStockfish {
  close(): Promise<void>;
}

export function createResourceCleanup(
  database: ClosableDatabase,
  stockfish: ClosableStockfish,
): () => Promise<void> {
  let cleanup: Promise<void> | undefined;
  return () => {
    cleanup ??= (async () => {
      let firstError: unknown;
      try {
        await stockfish.close();
      } catch (error) {
        firstError = error;
      }
      try {
        if (database.open) database.close();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== undefined) {
        if (firstError instanceof Error) throw firstError;
        throw new Error(
          typeof firstError === 'string'
            ? firstError
            : 'Resource cleanup failed',
        );
      }
    })();
    return cleanup;
  };
}

export async function startBackend(): Promise<void> {
  const config = parseBackendConfig();
  const database = openDatabase(config.databasePath);
  let stockfish: StockfishJsAnalyzer | undefined;
  const stockfishResource: ClosableStockfish = {
    close: () => stockfish?.close() ?? Promise.resolve(),
  };
  const closeResources = createResourceCleanup(database, stockfishResource);
  try {
    migrateDatabase(database);
    const games = createGameRepository(database);
    const settings = createSettingsRepository(database);
    stockfish = await StockfishJsAnalyzer.create();
    const selector = new LlamaCppClient({ baseUrl: config.llamaBaseUrl });
    const traceHub = config.demoTrace ? new DecisionTraceHub() : undefined;
    const service = new GameService({
      games,
      settings,
      stockfish,
      selector,
      lock: new GameLock(),
      traceHub,
    });
    const app = buildApp({
      service,
      settings,
      config,
      traceHub,
      cleanup: closeResources,
      health: {
        database: () => ({ status: 'ready' }),
        stockfish: () => ({ status: 'ready' }),
        model: (signal) => selector.health(signal),
      },
    });
    const removeSignals = installShutdownHandlers(process, app);
    try {
      await app.listen({ host: config.host, port: config.port });
    } catch (error) {
      removeSignals();
      await app.close();
      throw error;
    }
  } catch (error) {
    await closeResources();
    throw error;
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  startBackend().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
