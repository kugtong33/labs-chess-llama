import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GameService } from '../../apps/gateway/src/game-service.js';
import { GameLock } from '../../apps/gateway/src/game-lock.js';
import { buildApp } from '../../apps/gateway/src/app.js';
import { LlamaCppClient } from '../../packages/llama-protocol/src/index.js';
import type {
  AnalysisRequest,
  RankedCandidate,
  StockfishAnalyzer,
} from '../../packages/stockfish-adapter/src/index.js';
import {
  createGameRepository,
  createSettingsRepository,
  migrateDatabase,
  openDatabase,
} from '../../packages/storage/src/index.js';

const host = '127.0.0.1';
const llamaPort = 18_080;
const gatewayPort = 3_001;
const temporaryRoot = await mkdtemp(join(tmpdir(), 'chess-llama-e2e-'));
let failuresRemaining = 0;

const llama = createServer((request, response) => {
  void handleLlamaRequest(request, response);
});
await listen(llama, llamaPort);

const database = openDatabase(join(temporaryRoot, 'chess-llama.sqlite'));
migrateDatabase(database);
const games = createGameRepository(database);
const settings = createSettingsRepository(database);
const stockfish = createDeterministicAnalyzer();
const selector = new LlamaCppClient({
  baseUrl: `http://${host}:${llamaPort}`,
  modelId: 'fake-qwen3.gguf',
  profileId: 'qwen3-4b-q4-k-m',
  quantization: 'Q4_K_M',
  backend: 'CPU-test-double',
});
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
  config: {
    host,
    port: gatewayPort,
    clientOrigin: 'http://127.0.0.1:5173',
    databasePath: join(temporaryRoot, 'chess-llama.sqlite'),
    llamaBaseUrl: `http://${host}:${llamaPort}`,
    logLevel: 'warn',
  },
  health: {
    database: () => ({ status: 'ready' }),
    stockfish: () => ({ status: 'ready' }),
    model: (signal) => selector.health(signal),
  },
});
await app.listen({ host, port: gatewayPort });

let closing: Promise<void> | undefined;
const close = () => {
  closing ??= (async () => {
    await app.close();
    database.close();
    await new Promise<void>((resolve, reject) => {
      llama.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(temporaryRoot, { recursive: true, force: true });
  })();
  return closing;
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  });
}

function createDeterministicAnalyzer(): StockfishAnalyzer {
  return {
    analyze(request: AnalysisRequest): Promise<RankedCandidate[]> {
      const ordered = [...request.legalMoves].sort((left, right) => {
        if (left.uci === 'e7e5') return -1;
        if (right.uci === 'e7e5') return 1;
        return left.uci.localeCompare(right.uci);
      });
      return Promise.resolve(
        ordered.slice(0, request.candidateLimit).map((move, index) => ({
          rank: index + 1,
          uci: move.uci,
          san: move.san,
          score: { type: 'cp' as const, value: 20 - index * 5 },
          normalizedScore: 20 - index * 5,
        })),
      );
    },
    close: () => Promise.resolve(),
  };
}

async function handleLlamaRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    return json(response, 200, { status: 'ok' });
  }
  if (request.method === 'POST' && request.url === '/__control/fail-next') {
    failuresRemaining = 2;
    return json(response, 200, { failuresRemaining });
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    return json(response, 404, { error: 'not found' });
  }
  const body = await readJson(request);
  if (failuresRemaining > 0) {
    failuresRemaining -= 1;
    return json(response, 503, { error: 'deterministic failure' });
  }
  const candidates = completionCandidates(body);
  const move = candidates[0];
  if (!move) return json(response, 400, { error: 'missing candidates' });
  return json(response, 200, {
    model: 'fake-qwen3.gguf',
    choices: [
      {
        message: {
          content: JSON.stringify({
            move,
            commentary: 'I challenge your center.',
          }),
        },
      },
    ],
    usage: { prompt_tokens: 64, completion_tokens: 8 },
    timings: { predicted_per_second: 40 },
  });
}

function completionCandidates(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.response_format)) return [];
  const jsonSchema = value.response_format.json_schema;
  if (!isRecord(jsonSchema) || !isRecord(jsonSchema.schema)) return [];
  const properties = jsonSchema.schema.properties;
  if (!isRecord(properties) || !isRecord(properties.move)) return [];
  return Array.isArray(properties.move.enum)
    ? properties.move.enum.filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(toBytes(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function toBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError('Request stream produced a non-byte chunk');
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
