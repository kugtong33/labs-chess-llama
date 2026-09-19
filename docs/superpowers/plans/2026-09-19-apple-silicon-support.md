# Apple Silicon llama.cpp Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete native development stack run on Apple Silicon through Homebrew llama.cpp with Metal while preserving Linux/WSL Docker CUDA and the four-container Compose deployment.

**Architecture:** The existing CLI selects a `docker-cuda` provider on Linux and a `native-metal` provider on Darwin arm64. Common model artifact and health logic stays provider-neutral; focused provider modules own container or native-process lifecycle.

**Tech Stack:** Bash 5, Node.js 24, TypeScript, Bats, Vitest, Homebrew llama.cpp, Metal, Docker Compose, CUDA.

**Spec:** Approved Apple Silicon support design from the conversation.

## Global Constraints

- Work directly on `master` as previously requested.
- Keep the public command names and exit codes unchanged.
- Select the runtime provider automatically; do not add a public provider switch.
- Keep Compose and its four containers Linux/WSL-only.
- Bind every native service to loopback.
- Use Qwen3-4B Q4_K_M and the existing qualification thresholds on every platform.
- Do not pin the Homebrew formula version; capability-check the installed server and Metal device.
- Do not require Docker, `flock`, `setsid`, `ss`, or GNU `sha256sum` for native macOS development.

## Review Focus

- A stale or reused PID must never let `model stop` signal an unrelated process.
- A healthy unowned llama server may be reused by `dev` but must never be stopped by cleanup.
- Darwin x86 and unsupported hosts must fail before downloading or starting runtime processes.
- Linux doctor and model commands must retain their Docker/CUDA behavior.
- Provider-specific failures must not corrupt the stable doctor envelope or logs result envelope.

---

### Task 1: Provider Contract and Portable Host Operations

**Files:**
- Create focused provider/host helpers under `scripts/cli/` and `packages/operations/src/`.
- Modify model, path, and runtime operations plus their Bats/Vitest tests.

**Interfaces:**
- Produces provider IDs `docker-cuda` and `native-metal`.
- Produces provider-neutral status `{ provider, runtimeState, healthy, modelId?, profileId?, port }`.
- Produces portable artifact download/hash, operation locking, port probing, and child supervision.

- [ ] Write failing tests for provider selection, unsupported platforms, portable verified downloads, locking, ports, and process supervision.
- [ ] Run focused tests and confirm failures are caused by missing provider/host behavior.
- [ ] Implement the minimal provider contract and portable helpers; remove Linux-only assumptions from common code.
- [ ] Run focused and full tests, then commit.

### Task 2: Native Metal Model Lifecycle

**Files:**
- Add the native provider and native runtime state manager.
- Modify the model router and model shell tests.

**Interfaces:**
- Consumes the provider and host contracts from Task 1.
- Produces native `pull/start/status/logs/stop` using Homebrew `llama-server` and owned state under `${XDG_STATE_HOME:-$HOME/.local/state}/chess-llama`.

- [ ] Write failing tests for Metal arguments, health/model discovery, owned stop, stale/mismatched PID refusal, logs, and external runtime detection.
- [ ] Run focused tests and confirm the native lifecycle is absent.
- [ ] Implement native start/status/logs/stop and common health/model identity checks.
- [ ] Run focused and full tests, then commit.

### Task 3: Platform-Aware Doctor, Dev, Telemetry, and Benchmark

**Files:**
- Modify doctor/dev/backend configuration, benchmark reporting, Compose backend metadata, and their tests.

**Interfaces:**
- Consumes the provider lifecycle from Task 2.
- Produces provider-specific doctor checks, portable dev supervision, `Metal`/`CUDA` health metadata, and provider-aware benchmark reports.

- [ ] Write failing tests for Metal doctor readiness/remediation, external reuse, cleanup ownership, status JSON, telemetry, and benchmark metadata.
- [ ] Run focused tests and confirm failures match the missing integration.
- [ ] Implement the platform-aware integration without changing public command names or exit codes.
- [ ] Run focused and full tests, build, lint, type-check, and Compose validation, then commit.

### Task 4: Apple Silicon CI and Documentation

**Files:**
- Modify CI and maintained setup, architecture, deployment, operations, benchmark, CLI design, and notice documentation.

**Interfaces:**
- Consumes the complete provider behavior from Tasks 1-3.
- Produces a canonical Apple Silicon onboarding path and a macOS arm64 verification job.

- [ ] Add the macOS CI job while leaving Linux authoritative for Compose/CUDA/container checks.
- [ ] Document Homebrew llama.cpp/Metal setup, the three runtime topologies, support boundaries, state/log paths, and real-hardware acceptance.
- [ ] Run formatting, links, active-vocabulary checks, all repository verification, and review the complete branch.
- [ ] Commit the CI and documentation changes.
