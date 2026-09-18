# Modular Compose Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-command, modular Docker Compose deployment backed only by digest-pinned public images.

**Architecture:** A root Compose aggregator includes separate model and application fragments. Idempotent Node bootstrap services prepare checksum-verified model weights and a built application workspace in named volumes before health-gated llama.cpp, gateway, and Nginx services start.

**Tech Stack:** Docker Compose, Node.js 24, pnpm 12.4.2, Nginx Unprivileged, llama.cpp CUDA, Vitest, SQLite.

**Spec:** `docs/superpowers/specs/2026-09-18-modular-compose-deployment-design.md`

## Global Constraints

- `docker compose up -d` from the repository root must work without flags after prerequisites are installed.
- The exact root filename is `docker.compose.yaml`; `.env` must set `COMPOSE_FILE=docker.compose.yaml`.
- Compose interpolation may use `${NAME}` only; inline defaults such as `${NAME:-fallback}` are forbidden.
- All service images are direct public images pinned by immutable SHA-256 digest in `.env`; no Dockerfiles or private images.
- Published ports bind to `127.0.0.1`; native Linux and WSL2 remain supported.
- Qwen3-4B Q4_K_M remains the default model and must be checksum verified against `config/runtime-manifest.json`.
- Existing native CLI lifecycle remains functional and separate from Compose-owned volumes.
- New behavior is implemented test-first, with focused red/green evidence before full-suite verification.

---

### Task 1: Checksum-verified model bootstrap

**Files:**
- Create: `infra/deployment/model-bootstrap.mjs`
- Create: `infra/deployment/model-bootstrap.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `MODEL_PROFILE_ID`, `RUNTIME_MANIFEST_PATH`, and `MODEL_DIRECTORY`.
- Produces: `<MODEL_DIRECTORY>/current.gguf` only after the selected manifest profile passes SHA-256 verification.

- [ ] Write focused tests for unknown profiles, valid cache reuse, successful atomic download, HTTP failure, and checksum mismatch.
- [ ] Run the focused test and confirm it fails because the bootstrap module is absent.
- [ ] Implement a built-in-Node downloader with dependency-injected fetch for tests, streamed hashing, partial-file cleanup, and atomic activation.
- [ ] Run focused and full Vitest suites, then commit.

### Task 2: Atomic application workspace bootstrap

**Files:**
- Create: `infra/deployment/workspace-bootstrap.mjs`
- Create: `infra/deployment/workspace-bootstrap.test.ts`

**Interfaces:**
- Consumes: `SOURCE_DIRECTORY`, `WORKSPACE_DIRECTORY`, `DATABASE_DIRECTORY`, and the root `packageManager` declaration.
- Produces: a built release selected through `<WORKSPACE_DIRECTORY>/current`, plus a gateway-writable database directory.

- [ ] Write focused tests for deployment allowlisting, ignored local artifacts, package-manager validation, successful atomic activation, and failed-build preservation of the previous release.
- [ ] Run the focused test and confirm the expected missing-module failure.
- [ ] Implement source hashing/copying, Corepack pnpm frozen install, monorepo build, atomic symlink activation, old-release cleanup, and database ownership preparation.
- [ ] Run focused and full Vitest suites, then commit.

### Task 3: Modular Compose topology and runtime configuration

**Files:**
- Create: `.env`, `docker.compose.yaml`, and `infra/deployment/{model,app}.compose.yaml`
- Create: `infra/deployment/nginx.conf` and deployment configuration tests
- Modify: `.gitignore`, `apps/gateway/src/config.ts`, and its tests

**Interfaces:**
- Produces services `model-bootstrap`, `llama`, `workspace-bootstrap`, `gateway`, and `client`.
- Publishes loopback endpoints at `5173`, `3001`, and `8080`.

- [ ] Add failing gateway and Compose configuration tests covering container host binding, root discovery, resolved variables, digest pins, loopback ports, volume ownership, health checks, and dependency conditions.
- [ ] Run focused tests and confirm failures reflect missing deployment configuration and rejected `0.0.0.0`.
- [ ] Implement the root aggregator, modular fragments, committed non-secret environment defaults, Nginx SPA/API/SSE proxying, security hardening, and gateway host support.
- [ ] Validate with Vitest, `docker compose config --quiet`, and Nginx configuration syntax, then commit.

### Task 4: Operations, CI, and final acceptance

**Files:**
- Modify: `README.md`, `docs/operations.md`, and `.github/workflows/ci.yml`
- Create: `docs/deployment.md`

**Interfaces:**
- Documents `docker compose up -d`, status/log commands, update/restart, safe teardown, and destructive teardown.

- [ ] Add deployment verification to CI, derive pnpm from `package.json`, and scan every runtime image declared in `.env`.
- [ ] Document first start, health/log inspection, persistence, native-mode conflicts, Linux/WSL2 prerequisites, and recovery from bootstrap failures.
- [ ] Run formatting, linting, type checking, unit tests, Bats, builds, Compose validation, and diff checks.
- [ ] Run a real GPU deployment smoke test, verify HTTP health and persistence without deleting existing user data, then commit.
