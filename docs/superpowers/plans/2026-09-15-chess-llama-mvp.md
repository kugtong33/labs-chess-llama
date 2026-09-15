# Chess Llama MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local browser chess game in which Stockfish shortlists credible moves and a quantized Qwen model running through llama.cpp chooses the final move and commentary, with persistent games and a unified management CLI.

**Architecture:** A pnpm TypeScript monorepo contains a React client, a Fastify gateway, focused domain/protocol/storage packages, and one `chess-llama` CLI. The gateway owns authoritative chess state and SQLite persistence; an official pinned llama.cpp CUDA container serves Qwen3 GGUF models, while Stockfish.js runs on CPU inside the gateway.

**Tech Stack:** Node.js 24 LTS, pnpm, strict TypeScript, React, Vite, Fastify, Zod, chess.js, Stockfish.js 18 lite WASM, Drizzle ORM, better-sqlite3, Commander, Pino, Docker Compose, Vitest, React Testing Library, and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-chess-llama-design.md`

## Global Constraints

- Target native Linux and Windows through WSL2 with an NVIDIA RTX 4060 and Docker GPU support.
- Bind the client, gateway, and llama.cpp host ports to `127.0.0.1` only.
- Default to Qwen3-4B Q4_K_M; keep Qwen3-1.7B Q4_K_M experimental until it passes the same benchmark gate.
- Stockfish may only shortlist; llama.cpp must select every AI move that is applied.
- Never apply a random, silent, or non-model fallback move.
- Persist games and user-facing settings in SQLite; do not persist raw prompts or hidden reasoning.
- Keep llama.cpp protocol details out of the client and chess-domain packages.
- Publish the project as GPL-3.0 and retain all required dependency notices.
- Use test-driven development for behavior and commit after every task.

---

## Planned File Map

```text
apps/cli/src/                 Commander commands and process orchestration
apps/client/src/              React routes, API client, and game presentation
apps/gateway/src/             Fastify composition, routes, and GameService
packages/contracts/src/       Zod API schemas and shared types
packages/chess-domain/src/    chess.js wrapper and domain transitions
packages/storage/src/         Drizzle schema, migrations, and repositories
packages/stockfish-adapter/src/ UCI process and candidate filtering
packages/llama-protocol/src/  llama-server HTTP adapter and structured output
config/                       Runtime source and generated immutable manifest
infra/compose.yaml            Hardened llama.cpp CUDA service
scripts/                      Runtime lock and license-notice generation
tests/e2e/                    Browser acceptance tests
tests/fixtures/               UCI, llama.cpp, and benchmark fixtures
```

The package dependency direction is:

```text
contracts <- client
contracts <- chess-domain <- storage
contracts <- llama-protocol
chess-domain <- stockfish-adapter
contracts + chess-domain + storage + stockfish-adapter + llama-protocol <- gateway
storage + gateway launchers + runtime management <- cli
```

### Task 1: Workspace Foundation and Shared Contracts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `LICENSE`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/game.ts`
- Create: `packages/contracts/src/settings.ts`
- Create: `packages/contracts/src/health.ts`
- Create: `packages/contracts/src/problem.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Consumes: only Zod.
- Produces: `Color`, `GameStatus`, `GameResult`, `MoveView`, `AiDecisionView`, `GameView`, `Settings`, request schemas, health schemas, and `ProblemDetails` used by every other package.

- [ ] **Step 1: Create the workspace and quality-tool configuration**

Use a private ESM root package with the following scripts and Node floor:

```json
{
  "name": "chess-llama",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.5.1",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

Configure pnpm for `apps/*` and `packages/*`, enable strict TypeScript with `noUncheckedIndexedAccess`, use ESLint flat config with type-aware rules, and ignore `node_modules`, `dist`, `coverage`, Playwright output, `.env`, `*.sqlite*`, and local XDG test directories. Copy the unmodified GPL-3.0 license text into `LICENSE`.

Install the current compatible releases and let pnpm record concrete semver ranges plus the exact lockfile resolutions; do not commit `"latest"` dependency specifiers:

```bash
pnpm add -Dw @eslint/js @types/node eslint prettier tsx tsup typescript typescript-eslint vitest
pnpm add --filter @chess-llama/contracts zod
```

- [ ] **Step 2: Add a failing contract-schema test**

```ts
import { describe, expect, it } from 'vitest';
import {
  AiMoveRequestSchema,
  CreateGameRequestSchema,
  GameViewSchema,
  SettingsSchema,
  SubmitMoveRequestSchema,
} from './index.js';

describe('public contracts', () => {
  it('accepts valid move requests and rejects stale shapes', () => {
    expect(SubmitMoveRequestSchema.parse({ from: 'e2', to: 'e4', expectedPly: 0 })).toEqual({
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    expect(() => SubmitMoveRequestSchema.parse({ from: 'e9', to: 'e4', expectedPly: -1 })).toThrow();
    expect(AiMoveRequestSchema.parse({ expectedPly: 1 })).toEqual({ expectedPly: 1 });
  });

  it('applies stable game and settings defaults', () => {
    expect(CreateGameRequestSchema.parse({})).toEqual({});
    const settings = SettingsSchema.parse({
      preferredHumanColor: 'white',
      boardOrientation: 'white',
      theme: 'system',
      commentaryStyle: 'concise',
      modelProfileId: 'qwen3-4b-q4-k-m',
      stockfishCandidateLimit: 5,
      stockfishMoveTimeMs: 100,
    });
    expect(settings.stockfishCandidateLimit).toBe(5);
  });

  it('requires authoritative game fields', () => {
    expect(() => GameViewSchema.parse({ id: 'game-1', status: 'active' })).toThrow();
  });
});
```

- [ ] **Step 3: Run the test and verify the contracts are missing**

Run: `pnpm install && pnpm vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL because `./index.js` and its exported schemas do not exist.

- [ ] **Step 4: Implement the contract schemas**

Use strict Zod objects. Define squares with `/^[a-h][1-8]$/`, promotion with `q|r|b|n`, nonnegative integer ply values, UUID game/move IDs, ISO timestamps, and these exact enums:

```ts
export const ColorSchema = z.enum(['white', 'black']);
export const GameStatusSchema = z.enum(['active', 'awaiting_ai', 'completed']);
export const GameResultSchema = z.enum(['1-0', '0-1', '1/2-1/2', '*']);
export const MoveActorSchema = z.enum(['human', 'llm']);
export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export const CommentaryStyleSchema = z.enum(['concise', 'coach', 'playful']);

export const SubmitMoveRequestSchema = z.object({
  from: SquareSchema,
  to: SquareSchema,
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  expectedPly: z.number().int().nonnegative(),
}).strict();

export const AiMoveRequestSchema = z.object({
  expectedPly: z.number().int().nonnegative(),
}).strict();
```

Define the remaining wire schemas with these exact fields:

```ts
export const EngineScoreSchema = z.object({
  type: z.enum(['cp', 'mate']),
  value: z.number().int(),
}).strict();

export const CandidateViewSchema = z.object({
  rank: z.number().int().min(1).max(5),
  uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
  san: z.string().min(1),
  score: EngineScoreSchema,
  normalizedScore: z.number().int(),
}).strict();

export const MoveViewSchema = z.object({
  id: z.string().uuid(),
  ply: z.number().int().positive(),
  color: ColorSchema,
  actor: MoveActorSchema,
  uci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
  san: z.string().min(1),
  fenAfter: z.string().min(1),
  createdAt: z.string().datetime(),
}).strict();

export const AiDecisionViewSchema = z.object({
  id: z.string().uuid(),
  moveId: z.string().uuid(),
  candidates: z.array(CandidateViewSchema).min(1).max(5),
  chosenUci: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/),
  commentary: z.string().min(1).max(240),
  modelId: z.string().min(1),
  profileId: z.string().min(1),
  quantization: z.string().min(1),
  latencyMs: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  tokensPerSecond: z.number().nonnegative().nullable(),
  retryCount: z.union([z.literal(0), z.literal(1)]),
  createdAt: z.string().datetime(),
}).strict();

export const GameViewSchema = z.object({
  id: z.string().uuid(),
  status: GameStatusSchema,
  humanColor: ColorSchema,
  currentFen: z.string().min(1),
  pgn: z.string(),
  result: GameResultSchema,
  modelProfileId: z.string().min(1),
  moves: z.array(MoveViewSchema),
  lastAiDecision: AiDecisionViewSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict();

export const SettingsSchema = z.object({
  preferredHumanColor: ColorSchema,
  boardOrientation: ColorSchema,
  theme: ThemeSchema,
  commentaryStyle: CommentaryStyleSchema,
  modelProfileId: z.string().min(1),
  stockfishCandidateLimit: z.number().int().min(1).max(5),
  stockfishMoveTimeMs: z.number().int().min(25).max(1000),
}).strict();

export const CreateGameRequestSchema = z.object({ humanColor: ColorSchema.optional() }).strict();
export const UpdateSettingsRequestSchema = SettingsSchema.partial().strict();
export const ResignRequestSchema = z.object({ expectedPly: z.number().int().nonnegative() }).strict();

export const ComponentHealthSchema = z.object({
  status: z.enum(['ready', 'loading', 'unavailable']),
  detail: z.string().optional(),
}).strict();
export const HealthResponseSchema = z.object({
  status: z.enum(['ready', 'loading', 'degraded']),
  components: z.object({
    gateway: ComponentHealthSchema,
    database: ComponentHealthSchema,
    stockfish: ComponentHealthSchema,
    model: ComponentHealthSchema.extend({
      modelId: z.string().nullable(),
      profileId: z.string().nullable(),
      quantization: z.string().nullable(),
      backend: z.string().nullable(),
    }),
  }).strict(),
}).strict();

export const ProblemDetailsSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  requestId: z.string().min(1),
  gameId: z.string().uuid().optional(),
  gameStatus: GameStatusSchema.optional(),
}).strict();
```

Export `z.infer` aliases for every schema and array response schemas for game listings.

- [ ] **Step 5: Verify the foundation**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts && pnpm typecheck && pnpm lint && pnpm format:check`

Expected: all commands exit 0.

- [ ] **Step 6: Commit the foundation**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .prettierrc.json .gitignore vitest.config.ts LICENSE packages/contracts
git commit -m "chore: establish typed monorepo foundation"
```

### Task 2: Authoritative Chess Domain

**Files:**
- Create: `packages/chess-domain/package.json`
- Create: `packages/chess-domain/tsconfig.json`
- Create: `packages/chess-domain/src/types.ts`
- Create: `packages/chess-domain/src/game.ts`
- Create: `packages/chess-domain/src/index.ts`
- Test: `packages/chess-domain/src/game.test.ts`

**Interfaces:**
- Consumes: `Color`, `GameResult`, and move request types from `@chess-llama/contracts`; `Chess` from `chess.js`.
- Produces: `reconstructGame(moves, initialFen?)`, `applyHumanMove(chess, input)`, `applyUciMove(chess, uci)`, `legalMoves(chess)`, `deriveGameResult(chess)`, and serializable `AppliedMove`/`LegalMove` types.

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { applyHumanMove, applyUciMove, deriveGameResult, reconstructGame } from './index.js';

describe('chess domain', () => {
  it('applies and reconstructs authoritative moves', () => {
    const chess = reconstructGame([]);
    const first = applyHumanMove(chess, { from: 'e2', to: 'e4' });
    expect(first).toMatchObject({ uci: 'e2e4', san: 'e4', color: 'white' });
    expect(reconstructGame([{ uci: 'e2e4' }]).fen()).toBe(first.fenAfter);
  });

  it('rejects illegal UCI and handles promotion', () => {
    expect(() => applyUciMove(reconstructGame([]), 'e2e5')).toThrow('Illegal move');
    const promoted = applyUciMove(
      reconstructGame([], '8/P7/8/8/8/8/7k/5K2 w - - 0 1'),
      'a7a8q',
    );
    expect(promoted.uci).toBe('a7a8q');
  });

  it('derives checkmate result', () => {
    const chess = reconstructGame([{ uci: 'f2f3' }, { uci: 'e7e5' }, { uci: 'g2g4' }, { uci: 'd8h4' }]);
    expect(deriveGameResult(chess)).toBe('0-1');
  });
});
```

Add focused cases for castling, en passant, stalemate, repetition, fifty-move draw, insufficient material, and malformed UCI.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm vitest run packages/chess-domain/src/game.test.ts`

Expected: FAIL because the domain functions are not defined.

- [ ] **Step 3: Implement the domain wrapper**

Install its explicit workspace and runtime dependencies:

```bash
pnpm add --filter @chess-llama/chess-domain chess.js @chess-llama/contracts@workspace:*
```

Expose only serializable values outside the package:

```ts
export interface LegalMove {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface AppliedMove extends LegalMove {
  color: Color;
  fenAfter: string;
  pgnAfter: string;
  gameOver: boolean;
  result: GameResult;
}

export function applyUciMove(chess: Chess, uci: string): AppliedMove {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) throw new InvalidMoveError(`Malformed UCI move: ${uci}`);
  return applyHumanMove(chess, {
    from: match[1] as Square,
    to: match[2] as Square,
    promotion: match[3] as AppliedMove['promotion'],
  });
}
```

Clone or reconstruct before applying when callers need immutable behavior. Convert chess.js exceptions into `InvalidMoveError`; do not expose chess.js objects through package interfaces.

- [ ] **Step 4: Run domain and workspace checks**

Run: `pnpm vitest run packages/chess-domain/src/game.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 5: Commit the chess domain**

```bash
git add packages/chess-domain pnpm-lock.yaml
git commit -m "feat: add authoritative chess domain"
```

### Task 3: SQLite Schema, Migrations, and Repositories

**Files:**
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/drizzle.config.ts`
- Create: `packages/storage/src/schema.ts`
- Create: `packages/storage/src/database.ts`
- Create: `packages/storage/src/game-repository.ts`
- Create: `packages/storage/src/settings-repository.ts`
- Create: `packages/storage/src/types.ts`
- Create: `packages/storage/src/test-support.ts`
- Create: `packages/storage/src/index.ts`
- Create: `packages/storage/drizzle/0000_initial.sql`
- Test: `packages/storage/src/repositories.test.ts`

**Interfaces:**
- Consumes: serializable domain moves and shared settings/game types.
- Produces: `openDatabase(path)`, `migrateDatabase(db)`, `GameRepository`, `SettingsRepository`, `GameAggregate`, and online backup support.

- [ ] **Step 1: Write failing repository tests against a temporary database**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestStorage } from './test-support.js';

describe('SQLite repositories', () => {
  it('persists an awaiting AI turn across reopen', () => {
    const harness = createTestStorage();
    const game = harness.games.create({ humanColor: 'white', modelProfileId: 'qwen3-4b-q4-k-m' });
    harness.games.recordHumanMove(game.id, {
      id: crypto.randomUUID(), ply: 1, color: 'white', actor: 'human',
      uci: 'e2e4', san: 'e4', fenAfter: 'fen-after-e4', pgnAfter: '1. e4',
    });
    harness.closeAndReopen();
    expect(harness.games.getRequired(game.id).status).toBe('awaiting_ai');
  });

  it('rejects duplicate ply and persists settings', () => {
    const harness = createTestStorage();
    const game = harness.games.create({ humanColor: 'white', modelProfileId: 'qwen3-4b-q4-k-m' });
    const move = { id: crypto.randomUUID(), ply: 1, color: 'white', actor: 'human' as const,
      uci: 'e2e4', san: 'e4', fenAfter: 'fen', pgnAfter: '1. e4' };
    harness.games.recordHumanMove(game.id, move);
    expect(() => harness.games.recordHumanMove(game.id, { ...move, id: crypto.randomUUID() })).toThrow();
    expect(harness.settings.update({ theme: 'dark' }).theme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the repository tests and confirm failure**

Run: `pnpm vitest run packages/storage/src/repositories.test.ts`

Expected: FAIL because storage modules and migration do not exist.

- [ ] **Step 3: Add the initial reviewed SQL migration**

Create strict tables with integer timestamps and JSON stored as validated text:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'awaiting_ai', 'completed')),
  human_color TEXT NOT NULL CHECK (human_color IN ('white', 'black')),
  current_fen TEXT NOT NULL,
  pgn TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '*' CHECK (result IN ('1-0', '0-1', '1/2-1/2', '*')),
  model_profile_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE TABLE moves (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL CHECK (ply > 0),
  color TEXT NOT NULL CHECK (color IN ('white', 'black')),
  actor TEXT NOT NULL CHECK (actor IN ('human', 'llm')),
  uci TEXT NOT NULL,
  san TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, ply)
) STRICT;

CREATE TABLE ai_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  move_id TEXT NOT NULL UNIQUE REFERENCES moves(id) ON DELETE CASCADE,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  chosen_uci TEXT NOT NULL,
  commentary TEXT NOT NULL CHECK (length(commentary) <= 240),
  model_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  quantization TEXT NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  tokens_per_second REAL,
  retry_count INTEGER NOT NULL CHECK (retry_count IN (0, 1)),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  preferred_human_color TEXT NOT NULL CHECK (preferred_human_color IN ('white', 'black')),
  board_orientation TEXT NOT NULL CHECK (board_orientation IN ('white', 'black')),
  theme TEXT NOT NULL CHECK (theme IN ('system', 'light', 'dark')),
  commentary_style TEXT NOT NULL CHECK (commentary_style IN ('concise', 'coach', 'playful')),
  model_profile_id TEXT NOT NULL,
  stockfish_candidate_limit INTEGER NOT NULL CHECK (stockfish_candidate_limit BETWEEN 1 AND 5),
  stockfish_move_time_ms INTEGER NOT NULL CHECK (stockfish_move_time_ms BETWEEN 25 AND 1000),
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO settings VALUES (1, 'white', 'white', 'system', 'concise', 'qwen3-4b-q4-k-m', 5, 100, unixepoch() * 1000);
```

- [ ] **Step 4: Implement database setup and repository transactions**

Install the runtime and migration dependencies:

```bash
pnpm add --filter @chess-llama/storage drizzle-orm better-sqlite3 @chess-llama/contracts@workspace:* @chess-llama/chess-domain@workspace:*
pnpm add -D --filter @chess-llama/storage drizzle-kit @types/better-sqlite3
```

`openDatabase()` must set `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, and `synchronous=NORMAL`. Implement these exact repository operations:

```ts
export interface GameRepository {
  create(input: { humanColor: Color; modelProfileId: string }): GameAggregate;
  get(id: string): GameAggregate | null;
  getRequired(id: string): GameAggregate;
  list(): GameAggregate[];
  recordHumanMove(gameId: string, move: PersistableMove): GameAggregate;
  recordAiMove(gameId: string, move: PersistableMove, decision: PersistableAiDecision): GameAggregate;
  markCompleted(gameId: string, result: GameResult): GameAggregate;
}

export interface SettingsRepository {
  get(): Settings;
  update(patch: Partial<Settings>): Settings;
}
```

Human and AI recording methods must update `current_fen`, `pgn`, status, result, and timestamps in one transaction. Parse every JSON column through a Zod schema when reading.

- [ ] **Step 5: Add migration status and online backup functions**

Expose `getMigrationStatus(): { current: string | null; expected: string; pending: boolean }` and `backupDatabase(destination): Promise<void>`. Backup must write to a temporary sibling and atomically rename only after SQLite reports success.

- [ ] **Step 6: Verify storage behavior**

Run: `pnpm vitest run packages/storage/src/repositories.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS, including reopen, constraint, transaction rollback, migration idempotence, and backup cases.

- [ ] **Step 7: Commit storage**

```bash
git add packages/storage pnpm-lock.yaml
git commit -m "feat: add persistent SQLite repositories"
```

### Task 4: Stockfish Candidate Analysis

**Files:**
- Create: `packages/stockfish-adapter/package.json`
- Create: `packages/stockfish-adapter/tsconfig.json`
- Create: `packages/stockfish-adapter/src/types.ts`
- Create: `packages/stockfish-adapter/src/uci-parser.ts`
- Create: `packages/stockfish-adapter/src/filter.ts`
- Create: `packages/stockfish-adapter/src/stockfish-js.ts`
- Create: `packages/stockfish-adapter/src/index.ts`
- Create: `packages/stockfish-adapter/src/stockfish.d.ts`
- Test: `packages/stockfish-adapter/src/uci-parser.test.ts`
- Test: `packages/stockfish-adapter/src/filter.test.ts`
- Test: `packages/stockfish-adapter/src/stockfish-js.integration.test.ts`
- Create: `tests/fixtures/stockfish/multipv.txt`

**Interfaces:**
- Consumes: authoritative FEN/legal UCI moves and shared `EngineScore`/candidate contracts.
- Produces: `StockfishAnalyzer.analyze(request) => Promise<RankedCandidate[]>` with normalized scores and filtered credible candidates.

- [ ] **Step 1: Write failing parser and filter tests**

```ts
import { describe, expect, it } from 'vitest';
import { filterCredibleCandidates, normalizeScore, parseInfoLine } from './index.js';

describe('Stockfish scoring', () => {
  it('parses MultiPV and normalizes mate scores', () => {
    expect(parseInfoLine('info depth 14 multipv 2 score cp 34 nodes 10 pv e7e5 g1f3')).toMatchObject({
      rank: 2, score: { type: 'cp', value: 34 }, uci: 'e7e5',
    });
    expect(normalizeScore({ type: 'mate', value: 3 })).toBe(99_997);
    expect(normalizeScore({ type: 'mate', value: -3 })).toBe(-99_997);
  });

  it('keeps the best move and alternatives within 150 centipawns', () => {
    const result = filterCredibleCandidates([
      { rank: 1, uci: 'e7e5', san: 'e5', score: { type: 'cp', value: 30 } },
      { rank: 2, uci: 'c7c5', san: 'c5', score: { type: 'cp', value: -40 } },
      { rank: 3, uci: 'f7f6', san: 'f6', score: { type: 'cp', value: -300 } },
    ], 150);
    expect(result.map(({ uci }) => uci)).toEqual(['e7e5', 'c7c5']);
  });
});
```

- [ ] **Step 2: Run the unit tests and verify failure**

Run: `pnpm vitest run packages/stockfish-adapter/src/uci-parser.test.ts packages/stockfish-adapter/src/filter.test.ts`

Expected: FAIL because parser/filter exports do not exist.

- [ ] **Step 3: Implement UCI parsing and credibility filtering**

Install Stockfish.js and the shared/domain packages:

```bash
pnpm add --filter @chess-llama/stockfish-adapter stockfish @chess-llama/contracts@workspace:* @chess-llama/chess-domain@workspace:*
```

Define:

```ts
export interface RankedCandidate {
  rank: number;
  uci: string;
  san: string;
  score: EngineScore;
  normalizedScore: number;
}
export interface AnalysisRequest {
  fen: string;
  legalMoves: readonly LegalMove[];
  candidateLimit: number;
  moveTimeMs: number;
  maxLossCp: number;
  signal?: AbortSignal;
}
export interface StockfishAnalyzer {
  analyze(request: AnalysisRequest): Promise<RankedCandidate[]>;
  close(): Promise<void>;
}
```

Parse only the last `info` record for each `multipv` rank before `bestmove`. Join parsed UCI values with the authoritative legal-move list to obtain SAN; reject an engine result absent from that list. Sort by rank and always retain rank 1 before applying the 150-centipawn threshold.

- [ ] **Step 4: Write the failing real-engine integration test**

```ts
it('returns legal candidates from Stockfish.js lite-single', async () => {
  const analyzer = await StockfishJsAnalyzer.create();
  const chess = reconstructGame([{ uci: 'e2e4' }]);
  const candidates = await analyzer.analyze({
    fen: chess.fen(), legalMoves: legalMoves(chess), candidateLimit: 5,
    moveTimeMs: 25, maxLossCp: 150,
  });
  expect(candidates.length).toBeGreaterThan(0);
  expect(legalMoves(chess).map((move) => move.uci)).toContain(candidates[0]!.uci);
  await analyzer.close();
});
```

- [ ] **Step 5: Implement the Stockfish.js lifecycle**

Resolve `stockfish/bin/stockfish-18-lite-single.js` using `createRequire(import.meta.url)`, spawn it with `process.execPath`, send `uci` and `isready`, then serialize analyses through one promise queue. For each request send `setoption name MultiPV value N`, `position fen ...`, and `go movetime ...`; collect lines until `bestmove`. On abort send `stop`, discard collected output, and reject with `AbortError`. On timeout kill and lazily recreate the process for the next request.

- [ ] **Step 6: Verify Stockfish behavior**

Run: `pnpm vitest run packages/stockfish-adapter && pnpm typecheck && pnpm lint`

Expected: unit and real-WASM integration tests pass.

- [ ] **Step 7: Commit the Stockfish adapter**

```bash
git add packages/stockfish-adapter tests/fixtures/stockfish pnpm-lock.yaml
git commit -m "feat: add Stockfish candidate shortlisting"
```

### Task 5: llama.cpp Protocol Translation

**Files:**
- Create: `packages/llama-protocol/package.json`
- Create: `packages/llama-protocol/tsconfig.json`
- Create: `packages/llama-protocol/src/types.ts`
- Create: `packages/llama-protocol/src/prompt.ts`
- Create: `packages/llama-protocol/src/schema.ts`
- Create: `packages/llama-protocol/src/client.ts`
- Create: `packages/llama-protocol/src/index.ts`
- Test: `packages/llama-protocol/src/client.test.ts`
- Test: `packages/llama-protocol/src/prompt.test.ts`
- Create: `tests/fixtures/llama/chat-completion.json`

**Interfaces:**
- Consumes: filtered `MoveCandidate` values and a model profile ID.
- Produces: `MoveSelector`, `LlamaCppClient`, `ModelHealth`, `MoveSelection`, and inference metrics without leaking wire fields to callers.

- [ ] **Step 1: Write failing prompt and client tests**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMoveResponseFormat, buildPrompt, LlamaCppClient } from './index.js';

const candidates = [
  { rank: 1, uci: 'e7e5', san: 'e5', normalizedScore: 30 },
  { rank: 2, uci: 'c7c5', san: 'c5', normalizedScore: -40 },
];

it('builds an enum restricted to candidate UCI moves', () => {
  const format = buildMoveResponseFormat(candidates);
  expect(format.json_schema.schema.properties.move.enum).toEqual(['e7e5', 'c7c5']);
  expect(format.json_schema.schema.properties.commentary.maxLength).toBe(240);
});

it('prompts for no-think output without exposing engine scores', () => {
  const prompt = buildPrompt({ fen: 'fen', sanHistory: ['e4'], candidates, commentaryStyle: 'concise' });
  expect(prompt).toContain('/no_think');
  expect(prompt).toContain('e7e5 (e5)');
  expect(prompt).not.toContain('-40');
});
```

Add fetch-mock cases for health 200/503, success, invalid JSON, non-candidate output, timeout, cancellation, metrics extraction, and success on the second of two attempts.

- [ ] **Step 2: Run protocol tests and verify failure**

Run: `pnpm vitest run packages/llama-protocol`

Expected: FAIL because the protocol implementation is absent.

- [ ] **Step 3: Define the provider-neutral interface**

Install the shared contracts dependency:

```bash
pnpm add --filter @chess-llama/llama-protocol @chess-llama/contracts@workspace:*
```

```ts
export interface MoveCandidate {
  rank: number;
  uci: string;
  san: string;
}
export interface SelectMoveRequest {
  fen: string;
  sanHistory: readonly string[];
  candidates: readonly MoveCandidate[];
  commentaryStyle: CommentaryStyle;
  modelProfileId: string;
  signal?: AbortSignal;
}
export interface MoveSelection {
  uci: string;
  commentary: string;
  modelId: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  tokensPerSecond: number | null;
  retryCount: 0 | 1;
}
export interface MoveSelector {
  health(signal?: AbortSignal): Promise<ModelHealth>;
  selectMove(request: SelectMoveRequest): Promise<MoveSelection>;
}
```

- [ ] **Step 4: Implement the exact structured chat request**

Send `POST /v1/chat/completions` with `temperature: 0.2`, `max_tokens: 128`, one system message, one user message, and:

```ts
{
  type: 'json_schema',
  json_schema: {
    name: 'chess_move',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        move: { type: 'string', enum: candidates.map((candidate) => candidate.uci) },
        commentary: { type: 'string', minLength: 1, maxLength: 240 },
      },
      required: ['move', 'commentary'],
    },
  },
}
```

The prompt must state that Stockfish already filtered the choices, list UCI and SAN without evaluation scores, request one strategic sentence in the configured style, repeat the JSON keys, and forbid claims about captures or checks unless supported by the SAN string.

- [ ] **Step 5: Implement bounded retry, validation, and metrics**

Use an eight-second per-attempt timeout linked to the caller signal. Retry once for network failure, HTTP 429/500/502/503/504, invalid JSON, or a move outside the candidate set. Do not retry caller cancellation or other 4xx responses. Parse token usage and llama.cpp timing extensions when present; use wall-clock latency regardless. Discard `reasoning_content` and never log request messages.

- [ ] **Step 6: Verify protocol behavior**

Run: `pnpm vitest run packages/llama-protocol && pnpm typecheck && pnpm lint`

Expected: PASS with both retry-count branches covered.

- [ ] **Step 7: Commit the protocol adapter**

```bash
git add packages/llama-protocol tests/fixtures/llama pnpm-lock.yaml
git commit -m "feat: translate chess turns to llama cpp"
```

### Task 6: Gateway Game Service and Concurrency

**Files:**
- Create: `apps/gateway/package.json`
- Create: `apps/gateway/tsconfig.json`
- Create: `apps/gateway/src/errors.ts`
- Create: `apps/gateway/src/game-lock.ts`
- Create: `apps/gateway/src/game-view.ts`
- Create: `apps/gateway/src/game-service.ts`
- Test: `apps/gateway/src/game-service.test.ts`

**Interfaces:**
- Consumes: domain functions, repositories, `StockfishAnalyzer`, and `MoveSelector`.
- Produces: `GameService.createGame`, `listGames`, `getGame`, `submitHumanMove`, `retryAiMove`, `resignGame`, and `exportPgn`.

- [ ] **Step 1: Write failing service tests with in-memory fakes**

```ts
it('persists the human move before selecting and then records the LLM move', async () => {
  const harness = createServiceHarness({ selectedUci: 'e7e5' });
  const game = await harness.service.createGame({ humanColor: 'white' });
  const updated = await harness.service.submitHumanMove(
    game.id, { from: 'e2', to: 'e4', expectedPly: 0 }, new AbortController().signal,
  );
  expect(harness.events).toEqual([
    'record-human:e2e4', 'analyze-stockfish', 'select-llama:e7e5,c7c5', 'record-ai:e7e5',
  ]);
  expect(updated.moves.map((move) => move.uci)).toEqual(['e2e4', 'e7e5']);
});

it('leaves a resumable awaiting_ai game when inference fails', async () => {
  const harness = createServiceHarness({ selectError: new Error('model offline') });
  const game = await harness.service.createGame({ humanColor: 'white' });
  await expect(harness.service.submitHumanMove(game.id, {
    from: 'e2', to: 'e4', expectedPly: 0,
  })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', gameStatus: 'awaiting_ai' });
  expect(harness.games.getRequired(game.id).status).toBe('awaiting_ai');
});
```

Add cases for stale ply, illegal move, duplicate concurrent requests, completed games, human Black opening turn, retry validity, cancellation, and an LLM choice that fails final domain validation.

- [ ] **Step 2: Run service tests and verify failure**

Run: `pnpm vitest run apps/gateway/src/game-service.test.ts`

Expected: FAIL because the service and lock do not exist.

- [ ] **Step 3: Implement keyed turn serialization**

Install all gateway workspace dependencies before compiling the service:

```bash
pnpm add --filter @chess-llama/gateway @chess-llama/contracts@workspace:* @chess-llama/chess-domain@workspace:* @chess-llama/storage@workspace:* @chess-llama/stockfish-adapter@workspace:* @chess-llama/llama-protocol@workspace:*
```

Implement a `GameLock` whose `runExclusive(gameId, operation)` chains promises per key and deletes idle keys in `finally`. Re-read the aggregate after acquiring the lock, compare `expectedPly` with `moves.length`, and throw `StalePlyError` before any mutation.

- [ ] **Step 4: Implement `GameService` orchestration**

```ts
export class GameService {
  constructor(private readonly dependencies: {
    games: GameRepository;
    settings: SettingsRepository;
    stockfish: StockfishAnalyzer;
    selector: MoveSelector;
    lock: GameLock;
  }) {}

  createGame(input: CreateGameRequest, signal?: AbortSignal): Promise<GameView>;
  listGames(): Promise<GameView[]>;
  getGame(id: string): Promise<GameView>;
  submitHumanMove(id: string, input: SubmitMoveRequest, signal?: AbortSignal): Promise<GameView>;
  retryAiMove(id: string, input: AiMoveRequest, signal?: AbortSignal): Promise<GameView>;
  resignGame(id: string, expectedPly: number): Promise<GameView>;
  exportPgn(id: string): Promise<string>;
}
```

Persist the human move before external calls. Pass Stockfish candidates without their numeric scores to the LLM-facing prompt but persist the full candidate snapshot with the final decision. Reconstruct from moves before both the human and AI application. If only one candidate survives, still call llama.cpp with a one-value enum so every applied AI move remains model-selected.

- [ ] **Step 5: Verify orchestration and concurrency**

Run: `pnpm vitest run apps/gateway/src/game-service.test.ts && pnpm typecheck && pnpm lint`

Expected: PASS and no unresolved promises after cancellation tests.

- [ ] **Step 6: Commit the game service**

```bash
git add apps/gateway pnpm-lock.yaml
git commit -m "feat: orchestrate persistent hybrid chess turns"
```

### Task 7: Fastify Gateway API

**Files:**
- Create: `apps/gateway/src/config.ts`
- Create: `apps/gateway/src/problem-handler.ts`
- Create: `apps/gateway/src/routes/health.ts`
- Create: `apps/gateway/src/routes/settings.ts`
- Create: `apps/gateway/src/routes/games.ts`
- Create: `apps/gateway/src/app.ts`
- Create: `apps/gateway/src/main.ts`
- Test: `apps/gateway/src/app.test.ts`

**Interfaces:**
- Consumes: `GameService`, settings repository, shared Zod schemas, and dependency health providers.
- Produces: the approved `/api` HTTP contract and `buildApp(dependencies)` for tests/CLI startup.

- [ ] **Step 1: Write failing injected-HTTP route tests**

```ts
it('uses the approved move and PGN routes', async () => {
  const app = buildTestApp();
  const created = await app.inject({ method: 'POST', url: '/api/games', payload: {} });
  const game = created.json<GameView>();
  const moved = await app.inject({
    method: 'POST', url: `/api/games/${game.id}/moves`,
    payload: { from: 'e2', to: 'e4', expectedPly: 0 },
  });
  expect(moved.statusCode).toBe(200);
  expect((await app.inject({ method: 'GET', url: `/api/games/${game.id}/pgn` })).headers['content-type'])
    .toContain('application/x-chess-pgn');
});

it('maps stale ply to problem+json', async () => {
  const response = await buildTestApp().inject({
    method: 'POST', url: `/api/games/${crypto.randomUUID()}/moves/ai`, payload: { expectedPly: 99 },
  });
  expect(response.headers['content-type']).toContain('application/problem+json');
});
```

Cover all listed endpoints, Zod validation, 404, 409, model loading, model unavailable with saved game extensions, database failure, CORS, request IDs, and loopback defaults.

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm vitest run apps/gateway/src/app.test.ts`

Expected: FAIL because the Fastify app is missing.

- [ ] **Step 3: Implement configuration and application composition**

Install the gateway transport and logging dependencies:

```bash
pnpm add --filter @chess-llama/gateway fastify @fastify/cors fastify-type-provider-zod zod pino
```

Validate environment input once at startup:

```ts
const GatewayConfigSchema = z.object({
  host: z.literal('127.0.0.1').default('127.0.0.1'),
  port: z.coerce.number().int().min(1024).max(65535).default(3001),
  clientOrigin: z.string().url().default('http://127.0.0.1:5173'),
  databasePath: z.string().min(1),
  llamaBaseUrl: z.string().url().default('http://127.0.0.1:8080'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
```

Use Pino redaction for request bodies on llama/model paths. Install a request abort controller that aborts when the HTTP connection closes.

- [ ] **Step 4: Implement the exact routes**

```text
GET  /api/health
GET  /api/settings
PUT  /api/settings
POST /api/games
GET  /api/games
GET  /api/games/:id
POST /api/games/:id/moves
POST /api/games/:id/moves/ai
POST /api/games/:id/resign
GET  /api/games/:id/pgn
```

The additional resign route is required by the approved Play view. Return PGN as UTF-8 with `Content-Disposition: attachment; filename="chess-llama-<game-id>.pgn"`. Return health components for gateway, database, Stockfish, and llama.cpp; use overall `loading`, `ready`, or `degraded` status.

- [ ] **Step 5: Implement stable problem responses**

Map validation to 400, missing games to 404, stale/locked/completed state to 409, unavailable dependencies to 503, and unexpected errors to 500. Never expose stack traces or prompt/model response bodies. Include Fastify's request ID and saved `gameId`/`gameStatus` extensions for recoverable AI failures.

- [ ] **Step 6: Verify the gateway API**

Run: `pnpm vitest run apps/gateway && pnpm typecheck && pnpm lint`

Expected: PASS for every approved route and problem mapping.

- [ ] **Step 7: Commit the gateway API**

```bash
git add apps/gateway pnpm-lock.yaml
git commit -m "feat: expose local chess gateway API"
```

### Task 8: Pinned llama.cpp Runtime and Model Management

**Files:**
- Create: `config/runtime-source.json`
- Create: `config/runtime-manifest.json`
- Create: `infra/compose.yaml`
- Create: `scripts/lock-runtime.mts`
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/paths.ts`
- Create: `apps/cli/src/runtime/types.ts`
- Create: `apps/cli/src/runtime/docker.ts`
- Create: `apps/cli/src/runtime/download.ts`
- Create: `apps/cli/src/runtime/model-manager.ts`
- Test: `apps/cli/src/runtime/model-manager.test.ts`

**Interfaces:**
- Consumes: Docker CLI, runtime manifest, XDG/environment configuration, and HTTP health endpoints.
- Produces: `ModelManager.pull`, `start`, `stop`, `status`, and `logs`; verified local GGUF paths; hardened Compose inputs.

- [ ] **Step 1: Add runtime source configuration**

```json
{
  "image": "ghcr.io/ggml-org/llama.cpp:server-cuda",
  "profiles": [
    {
      "id": "qwen3-4b-q4-k-m",
      "repository": "Qwen/Qwen3-4B-GGUF",
      "file": "Qwen3-4B-Q4_K_M.gguf",
      "quantization": "Q4_K_M",
      "contextSize": 4096
    },
    {
      "id": "qwen3-1.7b-q4-k-m",
      "repository": "ggml-org/Qwen3-1.7B-GGUF",
      "file": "Qwen3-1.7B-Q4_K_M.gguf",
      "quantization": "Q4_K_M",
      "contextSize": 4096,
      "experimental": true
    }
  ]
}
```

- [ ] **Step 2: Implement and run the immutable runtime lock script**

The script must resolve the multi-platform image digest using:

```bash
docker buildx imagetools inspect ghcr.io/ggml-org/llama.cpp:server-cuda --format '{{json .Manifest.Digest}}'
```

For each profile, query `https://huggingface.co/api/models/<repository>?blobs=true`, locate the exact filename, and read its LFS SHA-256 OID. (`expand[]=siblings` returns filenames but omits LFS metadata.) Write `runtime-manifest.json` atomically with the image as `ghcr.io/ggml-org/llama.cpp@sha256:<digest>`, direct `resolve/main/<file>` URLs, checksums, and source fields. Validate the generated document before rename.

Run: `pnpm tsx scripts/lock-runtime.mts`

Expected: the manifest contains no mutable image tag and every profile has a 64-character lowercase SHA-256 value.

- [ ] **Step 3: Write failing model-manager tests with fake process and fetch adapters**

```ts
it('downloads atomically, verifies SHA-256, and starts loopback-only', async () => {
  const harness = createModelManagerHarness();
  await harness.manager.pull('qwen3-4b-q4-k-m');
  await harness.manager.start('qwen3-4b-q4-k-m');
  expect(harness.files).toContainEqual(expect.stringMatching(/Qwen3-4B-Q4_K_M\.gguf$/));
  expect(harness.dockerArgs.join(' ')).toContain('127.0.0.1:8080:8080');
  expect(harness.dockerArgs.join(' ')).toContain('--gpus all');
});

it('deletes a partial file after checksum mismatch', async () => {
  const harness = createModelManagerHarness({ corruptDownload: true });
  await expect(harness.manager.pull('qwen3-4b-q4-k-m')).rejects.toThrow('checksum');
  expect(harness.partialFiles()).toEqual([]);
});
```

- [ ] **Step 4: Run model-manager tests and verify failure**

Run: `pnpm vitest run apps/cli/src/runtime/model-manager.test.ts`

Expected: FAIL because runtime management is missing.

- [ ] **Step 5: Implement XDG paths and verified downloads**

Install the CLI runtime dependencies:

```bash
pnpm add --filter @chess-llama/cli commander execa zod @chess-llama/storage@workspace:*
```

Resolve config, data, backup, benchmark, and cache paths exactly as specified. Stream model downloads into `<filename>.partial`, hash while streaming, compare with the manifest, fsync, and atomically rename. Reuse a matching installed file; reject and quarantine a mismatched existing file as `<filename>.invalid-<timestamp>`.

- [ ] **Step 6: Implement hardened Compose runtime**

```yaml
services:
  llama:
    image: ${CHESS_LLAMA_IMAGE}
    container_name: chess-llama-model
    gpus: all
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    tmpfs: [/tmp]
    ports:
      - "127.0.0.1:${CHESS_LLAMA_MODEL_PORT:-8080}:8080"
    volumes:
      - "${CHESS_LLAMA_MODEL_DIR}:/models:ro"
    command:
      - -m
      - /models/${CHESS_LLAMA_MODEL_FILE}
      - --host
      - 0.0.0.0
      - --port
      - "8080"
      - --ctx-size
      - "4096"
      - --n-gpu-layers
      - "99"
      - --flash-attn
      - "on"
      - --parallel
      - "1"
      - --no-webui
```

Do not define a container-internal healthcheck because the minimal server image does not guarantee a separate HTTP client binary. Host-side `/v1/health` polling by `ModelManager` is authoritative.

- [ ] **Step 7: Implement model lifecycle operations**

Inject resolved manifest values into `docker compose`. `start` must verify the model before launch, wait at most 120 seconds for `/v1/health`, then confirm `/v1/models` reports the expected filename. `status` combines container state, health, model ID, profile, and configured port. `stop` removes only `chess-llama-model`; it never deletes weights. `logs` delegates to Compose and preserves its exit status.

- [ ] **Step 8: Verify runtime management**

Run: `pnpm vitest run apps/cli/src/runtime && pnpm typecheck && pnpm lint`

Expected: PASS with no Docker or network required by unit tests. Manually validate the generated manifest schema.

- [ ] **Step 9: Commit the pinned runtime**

```bash
git add config infra scripts apps/cli pnpm-lock.yaml
git commit -m "feat: manage pinned llama cpp runtime"
```

### Task 9: Unified `chess-llama` CLI

**Files:**
- Create: `apps/cli/src/dependencies.ts`
- Create: `apps/cli/src/output.ts`
- Create: `apps/cli/src/commands/client.ts`
- Create: `apps/cli/src/commands/gateway.ts`
- Create: `apps/cli/src/commands/model.ts`
- Create: `apps/cli/src/commands/database.ts`
- Create: `apps/cli/src/commands/doctor.ts`
- Create: `apps/cli/src/commands/dev.ts`
- Create: `apps/cli/src/program.ts`
- Create: `apps/cli/src/index.ts`
- Test: `apps/cli/src/program.test.ts`
- Test: `apps/cli/src/commands/dev.test.ts`

**Interfaces:**
- Consumes: runtime manager, storage management, package scripts, HTTP health checks, and injected process runners.
- Produces: the core namespaced `chess-llama` lifecycle contract with stable exit codes and signal behavior; Task 12 supplies the benchmark handler.

- [ ] **Step 1: Write failing command-tree tests**

```ts
it('exposes every approved command namespace', () => {
  const program = buildProgram(createFakeDependencies());
  expect(commandPaths(program)).toEqual([
    'client build', 'client dev', 'client serve',
    'db backup', 'db migrate', 'db status',
    'dev', 'doctor',
    'gateway dev', 'gateway health', 'gateway start',
    'model logs', 'model pull', 'model start', 'model status', 'model stop',
  ]);
});

it('stops only resources started by dev and preserves exit codes', async () => {
  const dependencies = createFakeDependencies();
  await runCli(['dev'], dependencies, dependencies.abortSignal);
  expect(dependencies.events).toEqual([
    'doctor', 'db:migrate', 'model:start', 'gateway:start', 'client:dev',
    'client:stop', 'gateway:stop', 'model:stop',
  ]);
});
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `pnpm vitest run apps/cli/src/program.test.ts apps/cli/src/commands/dev.test.ts`

Expected: FAIL because the program is missing.

- [ ] **Step 3: Implement the command tree and output contract**

Set the package bin to `dist/index.js`, emit a Node shebang, and implement `buildProgram(dependencies)`. Status commands print JSON on stdout by default; `--format human` prints aligned tables. Diagnostics go to stderr. Map errors to the approved exit codes: unexpected 1, input/config 2, prerequisite 3, runtime start 4, health 5, and storage/migration 6.

- [ ] **Step 4: Implement layer commands**

- Client commands invoke the client package's Vite/build/preview entry points with loopback host configuration.
- Gateway commands invoke its built entry point or development runner and make `health` request `/api/health`.
- Model commands delegate to `ModelManager` and accept `--profile`, defaulting to persisted settings or 4B when the database is unavailable.
- Database commands open the configured file, apply/status migrations, or produce an online backup.

- [ ] **Step 5: Implement `doctor` and root `dev`**

`doctor` must report individual checks for Node 24, pnpm, Docker daemon, Compose, in-container NVIDIA visibility, ports 5173/3001/8080, XDG directories, migration state, model installation, and health. Use a minimal command in the already-pinned CUDA image for the GPU check; do not pull an unrelated image.

`dev` runs doctor prerequisites, migrates, starts the model, then gateway and client. Track ownership flags for each started resource. On `SIGINT`, `SIGTERM`, or a child failure, stop owned resources in reverse order and return the first nonzero child exit code.

- [ ] **Step 6: Verify CLI behavior and executable output**

Run: `pnpm vitest run apps/cli && pnpm --filter @chess-llama/cli build && node apps/cli/dist/index.js --help`

Expected: tests pass and help lists all namespaces without starting Docker.

- [ ] **Step 7: Commit the unified CLI**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "feat: expose unified chess llama CLI"
```

### Task 10: Client API Layer and Application Shell

**Files:**
- Create: `apps/client/package.json`
- Create: `apps/client/tsconfig.json`
- Create: `apps/client/vite.config.ts`
- Create: `apps/client/index.html`
- Create: `apps/client/src/main.tsx`
- Create: `apps/client/src/app.tsx`
- Create: `apps/client/src/api/client.ts`
- Create: `apps/client/src/api/queries.ts`
- Create: `apps/client/src/components/layout.tsx`
- Create: `apps/client/src/components/runtime-status.tsx`
- Create: `apps/client/src/styles.css`
- Test: `apps/client/src/api/client.test.ts`
- Test: `apps/client/src/app.test.tsx`

**Interfaces:**
- Consumes: the shared Zod contracts and gateway `/api` endpoints.
- Produces: a validated `GatewayClient`, React Query hooks, routing shell, runtime status, and global responsive styling.

- [ ] **Step 1: Write failing API client tests**

```ts
it('parses successful responses and problem details', async () => {
  const fetcher = createFetchFixture([
    jsonResponse(validGameView),
    problemResponse({ type: 'ai-unavailable', title: 'AI unavailable', status: 503,
      detail: 'Model is offline', requestId: 'req-1', gameId: validGameView.id,
      gameStatus: 'awaiting_ai' }),
  ]);
  const client = new GatewayClient('http://127.0.0.1:3001', fetcher);
  expect((await client.getGame(validGameView.id)).id).toBe(validGameView.id);
  await expect(client.retryAiMove(validGameView.id, { expectedPly: 1 }))
    .rejects.toMatchObject({ status: 503, gameStatus: 'awaiting_ai' });
});
```

- [ ] **Step 2: Run client tests and verify failure**

Run: `pnpm vitest run apps/client/src/api/client.test.ts`

Expected: FAIL because the API client is missing.

- [ ] **Step 3: Implement the validated gateway client**

Install the client runtime and test dependencies:

```bash
pnpm add --filter @chess-llama/client react react-dom react-router-dom @tanstack/react-query react-chessboard @chess-llama/contracts@workspace:*
pnpm add -D --filter @chess-llama/client @types/react @types/react-dom @vitejs/plugin-react vite jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Provide methods matching every API route. Parse successful JSON with the shared response schema and parse non-2xx bodies with `ProblemDetailsSchema`; turn network failures into a typed `GatewayConnectionError`. For PGN, request a Blob and derive the filename from `Content-Disposition`.

- [ ] **Step 4: Write failing application-shell tests**

```tsx
it('renders navigation and degraded runtime state', async () => {
  renderApp({ initialPath: '/', gateway: createFakeGateway({ modelStatus: 'unavailable' }) });
  expect(await screen.findByRole('navigation')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Play' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'History' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
  expect(await screen.findByText(/chess-llama model start/)).toBeVisible();
});
```

- [ ] **Step 5: Implement the application shell**

Configure React Router routes `/`, `/games/:id`, `/history`, and `/settings`. Configure TanStack Query with explicit stale times, no retry for 4xx responses, and at most one retry for connection/503 responses. Poll health with bounded intervals only while loading or degraded. Use accessible landmarks, focus styles, reduced-motion support, and CSS variables for light/dark/system themes.

- [ ] **Step 6: Verify the client foundation**

Run: `pnpm vitest run apps/client && pnpm --filter @chess-llama/client build && pnpm typecheck && pnpm lint`

Expected: tests and production build pass.

- [ ] **Step 7: Commit the client foundation**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat: add validated chess client shell"
```

### Task 11: Play, History, and Settings Experiences

**Files:**
- Create: `apps/client/src/routes/play.tsx`
- Create: `apps/client/src/routes/history.tsx`
- Create: `apps/client/src/routes/settings.tsx`
- Create: `apps/client/src/components/game-board.tsx`
- Create: `apps/client/src/components/move-list.tsx`
- Create: `apps/client/src/components/ai-commentary.tsx`
- Create: `apps/client/src/components/game-actions.tsx`
- Create: `apps/client/src/components/problem-banner.tsx`
- Test: `apps/client/src/routes/play.test.tsx`
- Test: `apps/client/src/routes/history.test.tsx`
- Test: `apps/client/src/routes/settings.test.tsx`

**Interfaces:**
- Consumes: `GatewayClient` query/mutation hooks and authoritative `GameView` values.
- Produces: the complete approved browser experience and recoverable AI-turn workflow.

- [ ] **Step 1: Write failing Play route tests**

```tsx
it('submits a board move with expected ply and renders the AI decision', async () => {
  const gateway = createFakeGateway({ game: gameAtStart, afterMove: gameAfterE4E5 });
  renderGame(gameAtStart.id, gateway);
  await dragPiece('e2', 'e4');
  expect(gateway.submitHumanMove).toHaveBeenCalledWith(gameAtStart.id, {
    from: 'e2', to: 'e4', expectedPly: 0,
  }, expect.any(AbortSignal));
  expect(await screen.findByText('I challenge your center.')).toBeVisible();
  expect(screen.getByText('Qwen3-4B · Q4_K_M')).toBeVisible();
});

it('offers retry without replaying the human move', async () => {
  const gateway = createFakeGateway({ game: awaitingAiGame, retryResult: gameAfterE4E5 });
  renderGame(awaitingAiGame.id, gateway);
  await userEvent.click(await screen.findByRole('button', { name: 'Retry AI move' }));
  expect(gateway.retryAiMove).toHaveBeenCalledWith(awaitingAiGame.id, { expectedPly: 1 }, expect.any(AbortSignal));
});
```

Add tests for promotion choice, illegal drop snapback, thinking state, model loading, cancellation on navigation, stale 409 reload, checkmate, resignation, and the hybrid disclosure.

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm vitest run apps/client/src/routes`

Expected: FAIL because the routes and components are missing.

- [ ] **Step 3: Implement the Play route**

Use `react-chessboard` as a controlled board whose position comes from `GameView.fen`. Disable dragging when it is not the human turn, the game is completed, a mutation is pending, or the model is unavailable. Derive `expectedPly` from `game.moves.length`; never modify a local chess instance optimistically. Show:

- Board and orientation from settings.
- SAN move list grouped by move number.
- AI commentary and the exact hybrid disclosure.
- Model/profile/quantization, CUDA backend, latency, and tokens-per-second telemetry.
- New Game, Resign, Retry AI move, and Download PGN actions when applicable.

- [ ] **Step 4: Implement History and Settings routes**

History separates resumable and completed games, sorts newest first, and offers Resume or PGN Download. Settings edits the approved fields with bounded inputs: candidate limit 1-5 and search time 25-1000 ms. A model-profile change displays “Restart the model to apply this profile” and the exact CLI command; updating settings invalidates the settings query but does not restart Docker automatically.

- [ ] **Step 5: Implement accessible failure presentation**

Use an `aria-live="polite"` turn-status region and `role="alert"` for terminal failures. For model unavailability show `chess-llama model start`; for gateway loss show Reconnect; for 409 refetch automatically and announce that the game was refreshed. Abort in-flight move requests when the route unmounts.

- [ ] **Step 6: Verify all client routes**

Run: `pnpm vitest run apps/client && pnpm --filter @chess-llama/client build && pnpm typecheck && pnpm lint`

Expected: PASS, including keyboard navigation and reduced-motion assertions.

- [ ] **Step 7: Commit the complete client**

```bash
git add apps/client pnpm-lock.yaml
git commit -m "feat: build persistent hybrid chess experience"
```

### Task 12: Benchmark, End-to-End Tests, CI, and Documentation

**Files:**
- Create: `tests/fixtures/benchmarks/positions.json`
- Create: `apps/cli/src/commands/benchmark.ts`
- Test: `apps/cli/src/commands/benchmark.test.ts`
- Create: `tests/e2e/play.spec.ts`
- Create: `tests/e2e/recovery.spec.ts`
- Create: `tests/e2e/support.ts`
- Create: `playwright.config.ts`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/generate-third-party-notices.mts`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `README.md`
- Create: `docs/operations.md`
- Create: `docs/model-benchmark.md`

**Interfaces:**
- Consumes: the finished CLI, client, gateway, model profiles, and runtime manifest.
- Produces: repeatable model qualification, full-stack acceptance coverage, CI gates, license notices, and operator documentation.

- [ ] **Step 1: Commit a representative benchmark fixture and failing benchmark test**

Use named FEN cases with category and expected legal-move properties:

```json
[
  { "id": "opening-start", "category": "opening", "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { "id": "opening-after-e4", "category": "opening", "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" },
  { "id": "castle-both-sides", "category": "castling", "fen": "r3k2r/pppq1ppp/2npbn2/3Np3/3P4/2N1P3/PPPQ1PPP/R3K2R w KQkq - 4 10" },
  { "id": "en-passant", "category": "en-passant", "fen": "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3" },
  { "id": "promotion", "category": "promotion", "fen": "8/P7/8/8/8/8/7k/5K2 w - - 0 1" },
  { "id": "mate-in-one", "category": "forced-mate", "fen": "7k/8/5KQ1/8/8/8/8/8 w - - 0 1" },
  { "id": "rook-endgame", "category": "endgame", "fen": "8/5pk1/6p1/8/4R3/7P/5PP1/6K1 w - - 0 1" },
  { "id": "isolated-queen-pawn", "category": "positional", "fen": "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 4 9" }
]
```

The test must verify fixture FEN validity and assert that benchmark aggregation computes structured success before retry, success after retry, median latency, candidate membership, and commentary samples.

- [ ] **Step 2: Run benchmark tests and verify failure**

Run: `pnpm vitest run apps/cli/src/commands/benchmark.test.ts`

Expected: FAIL because aggregation and the command do not exist.

- [ ] **Step 3: Implement benchmark execution and qualification**

For each position, run the same Stockfish and llama adapters used by gameplay. Write a JSON report containing runtime manifest IDs, hardware summary, per-position candidates/selection/commentary/metrics, aggregate first-attempt success, after-retry success, and median latency. Print PASS only when candidate membership is 100%, first-attempt success is at least 95%, after-retry success is 100%, and median latency is below 3000 ms. Print commentary samples for required human review; never automate claims of semantic correctness.

Register `model benchmark` in `buildProgram()` with `--profile <id>` repeatable selection and `--format <json|human>`. Its handler must call the real installed Stockfish and llama adapters; missing model weights return exit code 3, failed qualification returns exit code 1, and successful qualification returns 0.

- [ ] **Step 4: Write Playwright full-stack tests**

Use a deterministic fake llama-server and real temporary SQLite database. Cover:

```ts
test('plays, persists, resumes, and exports a game', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New game' }).click();
  await drag(page, 'e2', 'e4');
  await expect(page.getByText('I challenge your center.')).toBeVisible();
  await page.reload();
  await expect(pieceAt(page, 'e5')).resolves.toBe('black-pawn');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PGN' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pgn$/);
});
```

Add recovery coverage where the fake model fails after the saved human move, the page reloads, and `/moves/ai` completes the turn without duplicating ply 1.

Implement `drag(page, from, to)` and `pieceAt(page, square)` in `tests/e2e/support.ts` using stable `data-square` and `data-piece` hooks owned by `GameBoard`; do not couple tests to generated react-chessboard class names.

- [ ] **Step 5: Add CI gates**

The GitHub Actions workflow must use Node 24, Corepack/pnpm cache, `pnpm install --frozen-lockfile`, formatting, linting, type checking, unit/integration tests with coverage, production builds, Playwright browser installation, and E2E tests. Do not require Docker, a GPU, or external model downloads in normal CI. Upload coverage and Playwright traces only on failure.

- [ ] **Step 6: Generate and review third-party notices**

Generate a deterministic notice file from the lockfile, then add explicit sections and source links for llama.cpp, Qwen3 weights, chess.js, react-chessboard, Stockfish, and Stockfish.js. Fail CI if regeneration changes the committed notice. Confirm GPL-3.0 headers/notices satisfy Stockfish redistribution requirements.

- [ ] **Step 7: Write operator and project documentation**

`README.md` must explain the honest hybrid architecture, Linux/WSL2 prerequisites, `pnpm install`, `chess-llama doctor`, `model pull`, `dev`, the default/experimental profiles, offline operation, tests, and license. `docs/operations.md` must document every CLI command, XDG path, port, backup/restore process, model restart, common Docker/CUDA/WSL2 failures, and complete local teardown that preserves weights by default. `docs/model-benchmark.md` must document the qualification thresholds and the human commentary-review checklist.

- [ ] **Step 8: Run full non-GPU verification**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
pnpm tsx scripts/generate-third-party-notices.mts
git diff --exit-code THIRD_PARTY_NOTICES.md
```

Expected: every command exits 0.

- [ ] **Step 9: Run target-hardware acceptance**

Run:

```bash
chess-llama doctor
chess-llama model pull --profile qwen3-4b-q4-k-m
chess-llama model start --profile qwen3-4b-q4-k-m
chess-llama model benchmark --profile qwen3-4b-q4-k-m
chess-llama dev
```

Expected: Docker sees the RTX 4060, llama-server reports the pinned 4B Q4_K_M model, the benchmark passes its automated gates, the commentary review is recorded, and a complete browser game remains playable after network access is disabled.

Run the same benchmark for `qwen3-1.7b-q4-k-m`. Change the default profile only if it independently passes every automated gate and the human commentary review; otherwise retain 4B.

- [ ] **Step 10: Commit release-ready MVP verification**

```bash
git add tests apps/cli/src/commands/benchmark.ts playwright.config.ts .github README.md docs THIRD_PARTY_NOTICES.md pnpm-lock.yaml
git commit -m "test: qualify chess llama MVP"
```

## Final Review Checklist

- [ ] Compare every design-spec goal, non-goal, API route, CLI command, persisted field, failure behavior, security control, and acceptance criterion with the implemented tasks above.
- [ ] Confirm `POST /api/games/:id/moves/ai` and `GET /api/games/:id/pgn` are the only AI-retry and PGN endpoint spellings.
- [ ] Confirm all model moves pass through both the dynamic candidate enum and final chess.js validation.
- [ ] Confirm normal CI is deterministic without Docker/network/GPU and target-hardware acceptance is documented separately.
- [ ] Confirm `git status --short` is clean after the final commit.
