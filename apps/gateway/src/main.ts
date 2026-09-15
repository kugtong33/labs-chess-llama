import { GameService } from './game-service.js';
import { GameLock } from './game-lock.js';
import { parseGatewayConfig } from './config.js';
import { buildApp } from './app.js';
import { LlamaCppClient } from '@chess-llama/llama-protocol';
import { StockfishJsAnalyzer } from '@chess-llama/stockfish-adapter';
import {
  createGameRepository,
  createSettingsRepository,
  migrateDatabase,
  openDatabase,
} from '@chess-llama/storage';

const config = parseGatewayConfig();
const database = openDatabase(config.databasePath);
let closed = false;
let stockfish: StockfishJsAnalyzer | undefined;
const closeResources = async () => {
  if (closed) return;
  closed = true;
  await stockfish?.close();
  if (database.open) database.close();
};

try {
  migrateDatabase(database);
  const games = createGameRepository(database);
  const settings = createSettingsRepository(database);
  stockfish = await StockfishJsAnalyzer.create();
  const selector = new LlamaCppClient({ baseUrl: config.llamaBaseUrl });
  const service = new GameService({
    games,
    settings,
    stockfish,
    selector,
    lock: new GameLock(),
  });
  const app = buildApp({
    service,
    settings,
    config,
    cleanup: closeResources,
    health: {
      database: () => ({ status: 'ready' }),
      stockfish: () => ({ status: 'ready' }),
      model: (signal) => selector.health(signal),
    },
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    await app.close();
    throw error;
  }
} catch (error) {
  await closeResources();
  throw error;
}
