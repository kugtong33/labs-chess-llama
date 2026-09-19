# Cross-Platform Setup Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give newcomers one accurate setup path that ends with a ready `./chess-llama dev` environment on Ubuntu 24.04 or Windows/WSL2, while stating macOS limitations honestly.

**Architecture:** A canonical setup guide owns platform prerequisites and the shared project bootstrap. README explains the native development and Compose topologies; deployment and operations link to the setup guide instead of duplicating operating-system commands.

**Tech Stack:** Markdown, Vitest, Bash, Docker Engine/Desktop, NVIDIA Container Toolkit, Node.js 24, Corepack, pnpm.

**Spec:** Approved cross-platform setup documentation plan from the conversation.

## Global Constraints

- Work directly on `master` as previously requested.
- Ubuntu 24.04 LTS and Ubuntu 24.04 on Windows/WSL2 are the supported full-runtime paths.
- macOS is source/build only; never imply that Docker Desktop can run the CUDA llama service there.
- Keep operating-system installation commands in one canonical setup guide.
- Derive pnpm from `package.json`; do not duplicate its numeric version in prose.
- Do not change CLI or runtime behavior.

## Review Focus

- Every command required by `doctor` must map to a documented package or setup step.
- PowerShell, WSL Bash, native Linux Bash, and macOS commands must be labeled unambiguously.
- WSL instructions must not install a Linux NVIDIA driver, Docker Engine, or NVIDIA Container Toolkit inside the distribution.
- Native development must not be described as using Nginx.
- macOS readers must not be led into model download or `dev` commands that cannot succeed.

---

### Task 1: Canonical Platform Setup Guide

**Files:**
- Create: `docs/setup.md`
- Create: `tests/documentation.test.ts`

**Interfaces:**
- Consumes: required startup checks from `scripts/cli/doctor.sh` and the package manager declaration in `package.json`.
- Produces: the canonical platform support matrix, prerequisite commands, shared bootstrap, and readiness contract.

- [ ] Write a failing documentation contract test for the setup guide, supported platforms, required tools, official source links, shared bootstrap, and macOS limitation.
- [ ] Run `pnpm vitest run tests/documentation.test.ts` and confirm failure because `docs/setup.md` does not exist.
- [ ] Add the canonical setup guide with Ubuntu 24.04, WSL2, and macOS sections plus one Linux/WSL2 project bootstrap.
- [ ] Run the focused test and formatting check.
- [ ] Commit the setup guide and contract.

### Task 2: Architecture and Documentation Entry Points

**Files:**
- Modify: `tests/documentation.test.ts`
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: `docs/setup.md` as the only detailed prerequisite source.
- Produces: separate native-development and Compose topology descriptions plus consistent links into setup.

- [ ] Add failing assertions for the two README topologies and setup-guide links from all three active entry points.
- [ ] Run the focused test and confirm the new assertions fail.
- [ ] Update README, deployment, and operations without duplicating platform installation commands.
- [ ] Run the focused test, formatting, lint, type checking, full unit/shell tests, build, and Compose validation.
- [ ] Review active documentation for obsolete architecture and setup vocabulary, then commit.
