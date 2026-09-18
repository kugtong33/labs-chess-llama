# Modular Compose Deployment Design

## Goal

Provide a modular, local-only deployment that starts from a clean checkout with `docker compose up -d`, uses direct digest-pinned public images, and persists application state across restarts.

## Architecture

The committed root `.env` sets `COMPOSE_FILE=docker.compose.yaml`, the Compose project name, public image references, loopback ports, gateway settings, and the selected model profile. Compose files may use `${NAME}` interpolation, but never inline defaults such as `${NAME:-fallback}`. The root Compose file includes separate model and application fragments under `infra/deployment/`.

The model fragment runs an idempotent Node bootstrap service that reads `config/runtime-manifest.json`, downloads the selected GGUF into a named volume, verifies its SHA-256, and atomically activates it. The llama.cpp CUDA service starts only after bootstrap succeeds and becomes a health-gated dependency of the gateway.

The application fragment runs an idempotent Node bootstrap service that copies deployment-required repository files into a named workspace, installs the exact pnpm version from `package.json`, and builds the monorepo. A public Node image runs the gateway from that workspace. A public unprivileged Nginx image serves the React build, provides SPA fallback, and proxies `/api`, including unbuffered SSE decision traces.

## Runtime Boundaries

- Published ports `5173`, `3001`, and `8080` bind to `127.0.0.1` only.
- SQLite data, GGUF weights, the deployment workspace, and the pnpm store use independent named volumes.
- Runtime filesystems are read-only where practical, with `no-new-privileges`, dropped capabilities, and tmpfs scratch paths.
- Existing native CLI and `./chess-llama dev` behavior remains separate. Native and Compose modes must not run concurrently because their host ports overlap.
- `docker compose down` preserves volumes. Only the explicit destructive command `docker compose down -v` removes deployment data.

## Failure Handling

Valid cached weights are reused. Downloads write to a partial file, checksum before activation, and never replace a valid active model on failure. Application builds prepare a new release and change the active workspace only after a successful frozen install and build. Failed bootstraps stop dependent services and remain visible through Compose status and logs.

The gateway performs normal SQLite migrations on startup. Health checks enforce model bootstrap → llama → gateway → client. Application bootstrap may run concurrently with model bootstrap.

## Acceptance

Automated coverage validates bootstrap success/failure behavior, gateway container binding, Compose resolution, digest-pinned images, loopback ports, health dependencies, volumes, and the absence of inline interpolation defaults. Real-GPU acceptance starts the clean deployment with one command, probes every layer, completes an AI move, verifies restart persistence, and confirms normal teardown retains data.
