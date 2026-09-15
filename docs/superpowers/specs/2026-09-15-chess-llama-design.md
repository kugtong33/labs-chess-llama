# Chess Llama Architecture Design

**Status:** Approved
**Date:** 2026-09-15  
**License:** GPL-3.0

## Summary

Chess Llama is a local, open-source chess showcase for llama.cpp. A human plays standard chess in a browser. Stockfish performs a short CPU search to produce a credible candidate set, and a small quantized language model running on an RTX 4060 through llama.cpp selects the final move and writes concise commentary. A local gateway owns rules, orchestration, persistence, and protocol translation. A single `chess-llama` CLI manages every layer on native Linux and WSL2.

The application works without network access after its dependencies, container image, and model weights have been downloaded.

## Goals

- Showcase local llama.cpp inference, CUDA use, structured output, latency, and token throughput.
- Use the smallest quantized model that produces credible choices and commentary on the target RTX 4060.
- Ensure every applied chess move is legal and comes from the model's constrained candidate selection.
- Persist games and settings across process and machine restarts.
- Give each architectural layer an independently usable CLI namespace.
- Establish strict typing, migrations, tests, security defaults, and reproducible runtime pins from the first commit.

## Non-goals

- Multiplayer, accounts, authentication, cloud deployment, rankings, clocks, puzzles, or chess variants.
- Matching Stockfish playing strength or assigning the LLM an Elo rating.
- Exposing the gateway or llama-server outside the local machine.
- Persisting hidden model reasoning or raw prompts.
- Supporting Windows processes outside WSL2, macOS, or non-NVIDIA GPUs in the MVP.

## Technology Baseline

- Node.js 24 LTS, TypeScript in strict mode, and pnpm workspaces.
- React and Vite for the browser client.
- Fastify with Zod-backed request and response validation for the gateway.
- `chess.js` for authoritative chess rules and notation.
- Stockfish.js 18 lite single-threaded WASM for CPU candidate analysis.
- Drizzle ORM with `better-sqlite3` and checked-in SQL migrations.
- Commander for the unified CLI and Pino for structured gateway logs.
- Vitest, React Testing Library, and Playwright for automated verification.
- Official llama.cpp CUDA server image, pinned by immutable digest.
- Qwen3-4B Q4_K_M as the default model profile; Qwen3-1.7B Q4_K_M as an experimental smaller profile.

## Repository Structure

```text
apps/
  cli/                 installable chess-llama executable and orchestration
  client/              React browser application
  gateway/             local HTTP service and application use cases
packages/
  contracts/           shared API schemas and generated TypeScript types
  chess-domain/        game rules, state transitions, and PGN behavior
  llama-protocol/      llama-server adapter and prompt/schema translation
  stockfish-adapter/   UCI lifecycle, analysis, and candidate filtering
  storage/             SQLite schema, migrations, and repositories
config/
  runtime-manifest.json pinned image and model artifacts
infra/
  compose.yaml         loopback-only llama.cpp runtime
docs/
  research/            cited feasibility research
  superpowers/specs/   approved architecture specifications
  superpowers/plans/   implementation plans
```

Each package owns one responsibility and exposes typed interfaces. The client depends only on `contracts`. The gateway composes the domain, protocol, Stockfish, and storage packages. The CLI calls package-level management interfaces and external processes; it does not duplicate their logic.

## Runtime Architecture

```text
                        chess-llama CLI
                 orchestration and diagnostics
                              |
          +-------------------+------------------+
          |                   |                  |
          v                   v                  v
   React chess client   Fastify gateway   llama.cpp container
          |                   |             RTX 4060 / CUDA
          |                   +-- protocol adapter
          |                   +-- chess.js rules
          |                   +-- Stockfish.js shortlist
          |                   +-- SQLite repository
          +---- HTTP/JSON ----+
```

### Client layer

The client renders state returned by the gateway and submits user intent. It never supplies a trusted FEN, PGN, game result, candidate list, or AI move. It cannot call llama-server or SQLite directly.

### Gateway layer

The gateway is the authoritative application boundary. It validates API requests, reconstructs chess positions, serializes turns per game, runs candidate analysis, requests the LLM choice, validates the result, persists state, and exposes health information.

### Protocol translation layer

The protocol package implements a provider-neutral `MoveSelector` interface and a llama.cpp adapter. It owns chat messages, Qwen `/no_think` behavior, JSON Schema generation, response parsing, timeouts, metrics extraction, and one retry. No llama.cpp-specific fields cross into the client or domain packages.

### llama.cpp setup layer

The model runtime is the official CUDA server container, bound on the host only at `127.0.0.1:8080`. It uses all available GPU layers, a 4,096-token context, flash attention, one inference slot, and no web UI, agent, or tool features. The writable model cache is the only persistent mount; the root filesystem is read-only with dropped capabilities and `no-new-privileges`.

### Database layer

The gateway is the only long-running SQLite writer. Storage is accessed through repository interfaces. Foreign keys, WAL mode, defensive settings, a busy timeout, and explicit transactions are enabled. Migrations are generated during development, reviewed as SQL, checked in, and applied through the CLI.

## Unified CLI Contract

The `apps/cli` package publishes one executable named `chess-llama`.

```text
chess-llama dev
chess-llama doctor

chess-llama client dev|build|serve
chess-llama gateway dev|start|health
chess-llama model pull|start|stop|status|logs|benchmark
chess-llama db migrate|status|backup
```

### Command behavior

- `dev` verifies prerequisites, applies pending migrations, starts the model, waits for health, and then starts the gateway and client. `SIGINT` and `SIGTERM` stop every process or container started by that invocation.
- `doctor` checks Node and pnpm versions, Docker availability, GPU visibility from the pinned CUDA image, required ports, writable XDG paths, migration status, and gateway/model health.
- `client dev|build|serve` wraps only client operations.
- `gateway dev|start` refuses to serve when migrations are pending. `gateway health` prints machine-readable JSON by default and a table with `--format human`.
- `model pull` pulls the pinned image and warms the selected model into the cache, then verifies and records its checksum.
- `model start` starts the container and blocks until health succeeds or a bounded timeout expires. `stop`, `status`, and `logs` manage or inspect only that container.
- `model benchmark` runs the committed position suite for one or more installed profiles and writes a timestamped JSON report under the XDG data directory while printing a summary table.
- `db migrate` applies checked-in migrations. `status` reports the current and expected schema versions. `backup` uses SQLite's online backup support and writes a timestamped database copy.

Stable CLI exit codes are `0` success, `1` unexpected failure, `2` invalid input or configuration, `3` missing prerequisite, `4` runtime start failure, `5` health-check failure, and `6` migration or storage failure. Every command supports `--help`; status-style commands support JSON output suitable for scripting.

## Configuration and Local Storage

Defaults follow the XDG base-directory specification and can be overridden with `CHESS_LLAMA_*` environment variables:

```text
configuration: $XDG_CONFIG_HOME/chess-llama/config.json
database:      $XDG_DATA_HOME/chess-llama/chess-llama.sqlite
backups:       $XDG_DATA_HOME/chess-llama/backups/
benchmarks:    $XDG_DATA_HOME/chess-llama/benchmarks/
model cache:   $XDG_CACHE_HOME/chess-llama/models/
```

When an XDG variable is absent, the standard `~/.config`, `~/.local/share`, and `~/.cache` locations are used. Operational configuration includes ports, paths, and an optional external llama-server URL. User-facing gameplay and display settings are stored in SQLite. CLI flags override environment variables, which override the configuration file, which overrides built-in defaults.

The committed runtime manifest defines a stable profile ID, container image digest, Hugging Face repository, GGUF quantization, model checksum, context length, and server flags. Changing the selected model profile requires a model restart and is reported clearly by the settings API.

## Chess and AI Turn Flow

1. The client creates or resumes a game through the gateway.
2. The client submits a human move with `from`, `to`, optional `promotion`, and `expectedPly`.
3. The gateway acquires the per-game turn lock, loads all persisted moves, reconstructs the game using `chess.js`, and rejects stale or illegal input.
4. In a transaction, the gateway writes the human move and current position and changes the game status to `awaiting_ai`.
5. Stockfish receives the authoritative FEN and runs a 100 ms search with `MultiPV=5`.
6. Candidate scores are normalized from the AI side's perspective. Mate scores map above or below the centipawn range according to side and distance. The best move is always retained; up to four additional moves are retained only when they are within 150 centipawns of the best normalized evaluation. This naturally narrows forced-mate positions.
7. The protocol adapter sends the authoritative FEN, recent SAN history, the filtered UCI/SAN candidates, and concise commentary instructions to llama-server.
8. A dynamic JSON Schema restricts `move` to the candidate UCI enum and requires a commentary string of at most 240 characters. The prompt repeats the required structure because llama.cpp grammars constrain output but do not teach the schema semantics to the model.
9. The gateway parses the response and independently verifies that the move remains a legal candidate for the persisted ply. A malformed response or transient server error is retried once.
10. In a transaction, the gateway writes the AI move and decision metadata, updates the position, and sets the game to `active` or `completed`.
11. The gateway returns the complete authoritative game view. The client animates the AI move only after receiving this response.

The human move is not rolled back if AI inference fails. The game remains `awaiting_ai`, persists across restart, and can resume through the dedicated AI-move endpoint. A random or silent fallback is forbidden.

## Public HTTP API

All routes are under `/api` and return JSON except the PGN download. Validation failures and service failures use `application/problem+json` with a stable problem type, HTTP status, human-readable detail, and request ID.

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

### Key request contracts

`POST /api/games` accepts an optional human color and otherwise uses the persisted preference. If the human selects Black, the new game begins in `awaiting_ai` and the gateway immediately runs the opening AI turn.

`POST /api/games/:id/moves` accepts:

```json
{
  "from": "e2",
  "to": "e4",
  "expectedPly": 0
}
```

`promotion` is omitted except for a promotion move. The request persists the human move and attempts the following AI turn before responding. If AI inference fails, the response describes the saved `awaiting_ai` state and supplies the retry action.

`POST /api/games/:id/moves/ai` accepts `{ "expectedPly": 1 }` and is valid only when the persisted state is `awaiting_ai` and it is the AI's turn.

`POST /api/games/:id/resign` accepts `{ "expectedPly": 12 }`, completes an active game with the opponent as winner, and returns HTTP 409 when the expected ply is stale or the game is already completed.

Mutating endpoints return the complete game view, including moves, current FEN, status, result, last AI commentary, and non-sensitive inference metrics. A stale `expectedPly` returns HTTP 409.

## Persistence Model

### `games`

- Text UUID primary key.
- Status: `active`, `awaiting_ai`, or `completed`.
- Human color, current FEN, PGN, result, and immutable model-profile snapshot.
- Created, updated, and optional completed timestamps.

### `moves`

- Text UUID primary key and game foreign key with cascade deletion.
- Unique `(game_id, ply)` constraint.
- Ply, color, actor (`human` or `llm`), UCI, SAN, resulting FEN, and timestamp.

### `ai_decisions`

- Text UUID primary key and unique AI-move foreign key.
- Candidate UCI/SAN/evaluation snapshot encoded as validated JSON.
- Chosen UCI, visible commentary, model ID, profile ID, quantization, latency, token counts, tokens per second, retry count, and timestamp.
- Hidden reasoning and raw prompts are never stored.

### `settings`

- Singleton row guarded by a database constraint.
- Preferred human side, board orientation, theme, commentary style, model profile, Stockfish candidate limit, and Stockfish search time.
- Defaults: White, White orientation, system theme, concise commentary, Qwen3-4B Q4_K_M, five candidates, and 100 ms.

## Client Experience

The responsive client has three routes:

- **Play:** chessboard, move history, AI commentary, turn state, New Game and Resign actions, and runtime telemetry.
- **History:** active and completed games with result, model profile, date, resume action, and PGN download.
- **Settings:** persisted gameplay, display, shortlist, and model-profile preferences.

The play view states: "Stockfish suggests candidates; Qwen via llama.cpp chooses and explains." It displays the loaded model, quantization, CUDA backend, response latency, and tokens per second. The UI never presents hidden chain-of-thought as commentary.

## Failure and Concurrency Behavior

- A model-unavailable state disables new AI requests and shows the exact `chess-llama model start` recovery command.
- Model loading is represented separately from failure; health polling uses bounded exponential backoff.
- A timeout, malformed response, or invalid choice is retried once. Further failure leaves the game `awaiting_ai` with a Retry action.
- The per-game turn lock and `expectedPly` prevent concurrent or duplicate turns. Late responses cannot modify a newer position.
- Client cancellation aborts the HTTP and llama-server requests. Persisted state remains resumable.
- Gateway or database failure leaves the last rendered position intact and offers reconnect/reload actions.
- On gateway startup, every `awaiting_ai` game remains explicitly retryable; no inference starts automatically during recovery.
- Logs use request and game IDs. Development logs are human-readable, production logs are structured JSON, and prompt bodies are redacted by default.

## Security

- Gateway, client preview server, and llama-server bind to loopback by default.
- The Docker port mapping is `127.0.0.1:8080:8080`; llama-server binds to `0.0.0.0` only inside the isolated container.
- The llama.cpp web UI, agent mode, tool use, and unaudited file access are disabled.
- The container uses a read-only root filesystem, a writable model-cache mount, a temporary `/tmp`, dropped capabilities, and `no-new-privileges`.
- API inputs, environment variables, configuration files, model output, and persisted JSON are schema-validated.
- SQL uses bound parameters through the storage layer. CORS accepts only the configured local client origin.
- Dependency, license, and container vulnerability checks run in CI. Runtime artifacts are pinned and checksummed.

## Verification Strategy

### Automated tests

- Chess-domain unit tests cover legal and illegal moves, promotion, castling, en passant, check, checkmate, stalemate, repetition, fifty-move draw, insufficient material, resignation, and PGN output.
- Stockfish-adapter tests cover UCI initialization, timeouts, MultiPV parsing, score perspective, mate normalization, 150-centipawn filtering, and process recovery. Recorded fixtures keep unit tests deterministic; a smaller suite runs the real WASM engine.
- Protocol tests cover health/model discovery, request translation, candidate enums, commentary bounds, Qwen no-think prompting, response parsing, metrics, cancellation, retry, and error mapping against a fake llama-server.
- Storage tests apply every migration to a temporary database and verify constraints, transactions, WAL configuration, resume behavior, settings updates, and online backup.
- Gateway integration tests exercise every endpoint, problem response, turn lock, stale ply, inference failure, retry, completion, and PGN response.
- CLI tests isolate XDG directories and substitute fake Docker/process adapters to verify commands, signals, output formats, and exit codes.
- Client tests cover rendering and interactions; Playwright covers create, play, interrupt, resume, complete, resign, change settings, and download PGN.

### CI and local acceptance

Normal CI runs formatting checks, linting, type checking, unit tests, integration tests with fake inference, production builds, and browser tests without a GPU. A separate local acceptance command requires Docker and the RTX 4060 and exercises the pinned real llama.cpp image and installed profiles.

### Model benchmark gate

The committed benchmark contains representative opening, tactical, positional, endgame, castling, en-passant, promotion, and forced-mate positions. A profile qualifies only when:

- Every accepted selection belongs to the gateway candidate set.
- At least 95% of turns return valid structured output without retry and 100% succeed after one retry.
- Median end-to-end AI turn latency is below three seconds on the RTX 4060 target.
- Human review finds no impossible move or capture claim in the generated commentary samples.

Qwen3-1.7B Q4_K_M replaces Qwen3-4B Q4_K_M as the default only if it passes the same gate. Otherwise 4B remains the documented smallest credible profile.

## MVP Acceptance Criteria

- `chess-llama doctor` validates a supported native Linux or WSL2 environment and CUDA access from Docker.
- `chess-llama dev` brings up a healthy local stack from an initialized installation and tears down what it started on exit.
- A human can play and complete a standard game against the hybrid opponent without any illegal applied move.
- Every AI move is selected by the llama.cpp model from the Stockfish-filtered candidate enum; no silent fallback is used.
- Games and settings survive gateway, model, and machine restarts.
- An `awaiting_ai` game recovers through `/api/games/:id/moves/ai` after model failure.
- Completed games export valid PGN through `/api/games/:id/pgn`.
- The play view visibly reports the hybrid design, model, quantization, CUDA backend, latency, and generation throughput.
- After initial downloads, a complete game works with network access disabled.
- The repository includes GPL-3.0 and all required third-party notices and source pointers.

## Research Basis

The supporting feasibility analysis and primary-source links are recorded in [`docs/research/2026-09-15-feasibility.md`](../../research/2026-09-15-feasibility.md).
