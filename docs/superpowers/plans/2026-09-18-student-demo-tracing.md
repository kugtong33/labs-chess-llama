# Student Demo Decision Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show students a live, correlated, five-layer account of how Stockfish and a local llama.cpp model produce every AI chess move.

**Architecture:** The gateway owns a typed, bounded in-memory trace hub. AI-turn orchestration publishes sanitized events to both Pino and a read-only SSE endpoint; the browser and a Bash-managed `curl` follower consume the same contract, while persisted AI decision records provide restart-safe per-move replay.

**Tech Stack:** TypeScript 6, Zod, Fastify/Pino, React 19, TanStack Query, native EventSource, Bash, curl, Node 24, Vitest, Testing Library, and Bats.

**Spec:** Approved conversational design from 2026-09-18; this document records its binding implementation decisions.

## Global Constraints

- Trace events are curated evidence only: never expose raw prompts, raw UCI traffic, secrets, database contents, or hidden chain-of-thought.
- Trace publication is best-effort and must never delay, fail, or roll back an AI move.
- The hub retains exactly the latest 200 events and sends heartbeats every 15 seconds.
- Layers are `client`, `gateway`, `stockfish`, `llama`, and `storage`; `all` is a CLI filter, not an event layer.
- `chess-llama dev` enables tracing by default; `CHESS_LLAMA_DEMO_TRACE=0` disables it. Direct gateway starts default to disabled unless the environment enables it.
- Human CLI output is the default; JSON mode emits one validated event object per line.
- Existing `lastAiDecision`, gameplay endpoints, exit codes, and `chess-llama model logs` remain compatible.
- Native Linux and WSL2 remain supported, with no new frontend framework or telemetry platform.

---

### Task 1: Shared trace, retry-progress, and decision-history foundations

**Files:**
- Create: `packages/contracts/src/trace.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/contracts.test.ts`
- Create: `apps/gateway/src/decision-trace-hub.ts`, `apps/gateway/src/decision-trace-hub.test.ts`
- Modify: `packages/llama-protocol/src/types.ts`, `packages/llama-protocol/src/client.ts`, `packages/llama-protocol/src/client.test.ts`
- Modify: `packages/storage/src/types.ts`, `packages/storage/src/game-repository.ts`, `packages/storage/src/repositories.test.ts`

**Interfaces:**
- Produces `DecisionTraceEventSchema`, `DecisionTraceEvent`, `DecisionTraceLayerSchema`, and `DecisionTraceFilter`.
- Produces `DecisionTraceHub.publish(input)`, `snapshot(filter)`, and `subscribe(filter, listener)` where publish assigns event ID, sequence, and timestamp.
- Produces optional `SelectMoveRequest.onProgress` events for attempt start and sanitized retry reason.
- Produces `GameRepository.listAiDecisions(gameId)` ordered by associated move ply.

- [ ] Write failing contract tests for strict, versioned trace variants and rejection of extra/raw fields.
- [ ] Run `pnpm vitest run packages/contracts/src/contracts.test.ts` and confirm failure because trace exports do not exist.
- [ ] Implement the trace schemas and exports. Common fields are schema version `1`, UUID event/trace IDs, nonnegative sequence, ISO timestamp, request ID, nullable UUID game ID, nullable positive ply, layer, stage, status, summary, and strict stage data.
- [ ] Run the contract test and confirm it passes.
- [ ] Write failing hub tests for ordered IDs, 200-event eviction, layer/game filtering, replay, unsubscribe, and isolation when one listener throws.
- [ ] Run `pnpm vitest run apps/gateway/src/decision-trace-hub.test.ts` and confirm failure because the hub does not exist.
- [ ] Implement the hub without awaiting listeners; catch listener failures and continue publishing.
- [ ] Run the hub tests and confirm they pass.
- [ ] Write failing llama client tests proving attempt progress and sanitized retry categories (`timeout`, `http`, `invalid_completion`, `transport`) without response bodies.
- [ ] Run `pnpm vitest run packages/llama-protocol/src/client.test.ts` and confirm the new tests fail.
- [ ] Implement the optional observer and confirm existing selectors need no changes.
- [ ] Run the llama tests and confirm they pass.
- [ ] Write a failing repository test inserting multiple AI decisions and expecting `listAiDecisions` in move-ply order.
- [ ] Run `pnpm vitest run packages/storage/src/repositories.test.ts` and confirm the method is missing.
- [ ] Implement the ordered query and mapping without a database migration.
- [ ] Run the focused tests plus `pnpm typecheck` and commit as `feat: add decision trace foundations`.

### Task 2: Gateway tracing, SSE, and decision-history APIs

**Files:**
- Modify: `apps/gateway/src/config.ts`, `apps/gateway/src/config.test.ts`
- Modify: `apps/gateway/src/game-service.ts`, `apps/gateway/src/game-service.test.ts`
- Create: `apps/gateway/src/routes/demo-events.ts`
- Modify: `apps/gateway/src/routes/games.ts`, `apps/gateway/src/app.ts`, `apps/gateway/src/app.test.ts`, `apps/gateway/src/main.ts`

**Interfaces:**
- Consumes the Task 1 hub, trace contracts, progress observer, and repository history query.
- Produces `GET /api/demo/events?layer=<layer>&gameId=<uuid>` as SSE and `GET /api/games/:id/decisions` as an ordered `AiDecisionView[]`.
- Adds a trace context carrying a UUID trace ID and Fastify request ID through AI-turn service methods.

- [ ] Write failing configuration tests: direct gateway default disabled; `CHESS_LLAMA_DEMO_TRACE=1|true` enables; `0|false` disables; other values fail validation.
- [ ] Implement the configuration field and pass its focused tests.
- [ ] Write failing game-service tests for exact success ordering across all five layers plus retry, Stockfish failure, llama failure, storage failure, and cancellation terminal events.
- [ ] Implement trace context and sanitized event publication around existing orchestration without changing chess behavior.
- [ ] Run `pnpm vitest run apps/gateway/src/game-service.test.ts` and confirm all tests pass.
- [ ] Write failing application tests for disabled SSE, SSE headers, buffered replay, layer/game filters, heartbeat cleanup, subscriber disconnect, decision-history ordering, and unchanged problem responses.
- [ ] Implement the SSE route with `text/event-stream`, `no-cache`, 15-second comments, SSE `id`, `event: decision-trace`, JSON `data`, and cleanup on connection close.
- [ ] Add the decision-history route and response validation.
- [ ] Subscribe Pino once to the hub using structured `layer`, `traceId`, `gameId`, `ply`, `stage`, and `status` fields; dispose it during application cleanup.
- [ ] Run gateway tests and `pnpm typecheck`; commit as `feat: stream layered decision traces`.

### Task 3: Unified Bash logs namespace

**Files:**
- Create: `scripts/cli/logs.sh`, `apps/operations/src/trace-stream.ts`, `apps/operations/src/trace-stream.test.ts`
- Modify: `scripts/cli/core.sh`, `apps/operations/package.json`, `tests/shell/core.bats`
- Create: `tests/shell/logs.bats`
- Modify: `scripts/cli/dev.sh`

**Interfaces:**
- Produces `chess-llama logs follow [--layer client|gateway|stockfish|llama|storage|all] [--game UUID] [--format human|json]`.
- The Bash command uses `curl --fail --silent --show-error --no-buffer` and pipes SSE to the compiled Node formatter while preserving both pipeline statuses.

- [ ] Write failing formatter tests for fragmented SSE chunks, comments, human rendering, JSONL output, invalid events, duplicate event IDs, and clean end-of-stream handling.
- [ ] Implement the streaming parser and formatter; human lines include time, uppercase layer, stage/status, short trace/game IDs, summary, and curated details.
- [ ] Run formatter tests and confirm they pass.
- [ ] Write failing Bats tests for root/namespaced help, defaults, every layer, URL filtering, UUID/format validation, missing operations build, gateway failure exit 5, formatter failure preservation, and Ctrl+C cleanup.
- [ ] Implement the Bash namespace, source it from core, and add the operations build entry.
- [ ] Update `dev` to export tracing enabled unless explicitly set to `0`, and log the trace endpoint state.
- [ ] Run focused Bats, ShellCheck, shfmt, build, and typecheck; commit as `feat: add layered trace log followers`.

### Task 4: Live Decision Pipeline and persisted per-move replay

**Files:**
- Create: `apps/client/src/api/decision-events.ts`, `apps/client/src/api/decision-events.test.ts`
- Create: `apps/client/src/components/decision-pipeline.tsx`, `apps/client/src/components/decision-pipeline.test.tsx`
- Modify: `apps/client/src/api/client.ts`, `apps/client/src/api/client.test.ts`, `apps/client/src/api/queries.ts`
- Modify: `apps/client/src/components/move-list.tsx`, `apps/client/src/routes/play.tsx`, related tests and styles
- Modify: `docs/operations.md`, `README.md`

**Interfaces:**
- Consumes the SSE trace contract and decision-history endpoint.
- Produces an EventSource-backed hook with reconnect state and event-ID deduplication.
- Produces a five-stage side panel and selectable earlier AI moves.

- [ ] Write failing API/hook tests for valid event parsing, deduplication, reconnect/disconnected state, bounded client memory, and fallback when tracing is disabled.
- [ ] Implement the EventSource adapter with injectable factory for tests and automatic native reconnection.
- [ ] Write failing gateway-client tests for ordered decision-history parsing and error handling; implement `getDecisions(id)` and its query.
- [ ] Write failing component/route tests for stage progression, candidate ranking and selected highlight, retry/failure/cancelled states, technical-detail disclosure, persisted fallback, earlier-move selection, keyboard access, and live-region announcements.
- [ ] Implement the Decision Pipeline, reuse existing commentary metrics, make AI move entries selectable, and stack the panel below the board at narrow widths.
- [ ] Add reduced-motion CSS that removes progress animation.
- [ ] Document the teaching model, safety boundary, five terminal commands, enable/disable flag, and the distinction between curated traces and raw `model logs`.
- [ ] Run client tests, full Vitest, full Bats, coverage, build, typecheck, ESLint, Prettier, ShellCheck, and shfmt; commit as `feat: add student decision pipeline`.

### Task 5: End-to-end acceptance and documentation verification

**Files:**
- Modify only if a failing acceptance check requires a covered fix.

**Interfaces:**
- Consumes all prior task interfaces; produces no new public API.

- [ ] Build the complete workspace and start the local stack with defaults.
- [ ] Follow gateway, Stockfish, and llama layers in separate commands; play one move and verify shared trace/game/ply correlation and Stockfish-before-llama ordering.
- [ ] Verify no raw prompt, private reasoning, secret, or raw UCI transcript appears.
- [ ] Refresh the browser and replay an earlier AI decision from SQLite.
- [ ] Disconnect a trace subscriber and confirm the move still completes and reconnect resumes without duplicates.
- [ ] Run `doctor --format human` and confirm required checks remain ready.
- [ ] Stop the stack cleanly, run the complete verification matrix once more, and commit any test-backed acceptance fixes as `fix: complete decision trace acceptance`.
