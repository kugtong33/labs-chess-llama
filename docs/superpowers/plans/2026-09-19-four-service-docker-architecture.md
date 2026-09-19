# Four-Service Docker Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `infra/` deployment with four clearly named, independently built Docker services: nginx, web, backend, and llama.

**Architecture:** A single root `compose.yaml` publishes only Nginx. Nginx routes browser content to web and `/api` to backend; backend owns chess, Stockfish, and SQLite and calls llama over the internal Compose network; llama downloads and verifies its selected model before starting inference.

**Tech Stack:** Docker Compose, Docker multi-stage builds, Nginx, Node.js 24, pnpm, Vite/React, Fastify, llama.cpp, Vitest, Bats, Playwright.

**Spec:** Approved 2026-09-19 four-service architecture from the conversation.

## Global Constraints

- Work directly on `master` as explicitly requested.
- Exactly four Compose services: `nginx`, `web`, `backend`, and `llama`.
- Each service owns a dedicated Dockerfile in its top-level folder.
- Only Nginx publishes a loopback host port.
- Remove `infra/` and all client/gateway vocabulary from active code and user-facing documentation.
- Keep only the approved six user-tunable environment variables.
- Preserve digest/checksum pinning, persistent database/model volumes, health ordering, and container hardening.

## Review Focus

- A clean checkout must resolve and build all four Compose services without bootstrap sidecars.
- Browser API and SSE traffic must remain same-origin and preserve unbuffered streaming.
- An interrupted or corrupt model download must not replace a valid cached model.
- Backend and llama must not publish host ports.
- Native CLI development must retain equivalent behavior under the new web/backend names.

---

### Task 1: Literal Service Vocabulary and Workspace Layout

- [ ] Update contracts and tests to expect `web` and `backend`; verify they fail against the current implementation.
- [ ] Move service source to top-level `web/` and `backend/`, move operations to `packages/operations/`, and update workspace/build/test discovery.
- [ ] Rename CLI, package, browser API, backend config, health, and trace vocabulary without compatibility aliases.
- [ ] Remove cross-origin browser configuration and verify unit, shell, type, and build checks.
- [ ] Commit the completed vocabulary/layout migration.

### Task 2: Service Images and Llama-Owned Model Lifecycle

- [ ] Move model-bootstrap tests to `llama/` and add entrypoint behavior tests; verify they fail before implementation.
- [ ] Add dedicated Dockerfiles for web, backend, nginx, and llama plus a root `.dockerignore`.
- [ ] Make llama safely download/reuse/verify the selected model and then exec llama.cpp.
- [ ] Verify focused model tests and Dockerfile builds/contracts.
- [ ] Commit the service image and llama lifecycle work.

### Task 3: Single Compose Topology and Nginx Gateway

- [ ] Replace deployment tests with expectations for the four-service graph and verify failure.
- [ ] Add `compose.yaml`, reduced `.env`, and Nginx routing configuration; remove old Compose files and `infra/`.
- [ ] Verify resolved configuration, routing semantics, volumes, health ordering, port isolation, and hardening.
- [ ] Commit the Compose/Nginx migration.

### Task 4: Documentation, CI, and Acceptance

- [ ] Update active documentation, operations guidance, CI configuration, and image-locking behavior.
- [ ] Run formatting, linting, type checking, unit/shell tests, builds, E2E where available, Compose validation, and image builds.
- [ ] Review the whole diff against the approved architecture and fix important findings with red-green tests.
- [ ] Commit final documentation and verification fixes.
