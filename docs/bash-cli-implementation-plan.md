# Bash CLI Migration Implementation Plan

## Public contract

- Provide `./chess-llama` and retain `pnpm chess-llama -- ...` as a wrapper.
- Preserve the `client`, `db`, `dev`, `doctor`, `gateway`, and `model` namespaces, JSON/human formats, environment overrides, repeatable benchmark profiles, and exit codes 0–6.
- Run React/Vite and Node applications directly through their native CLIs; keep llama.cpp in Docker Compose.

## Implementation sequence

1. Capture dispatcher and tool-invocation behavior with executable contract tests.
2. Add modular Bash paths, output, client, gateway, database, model, doctor, and supervisor layers.
3. Move runtime-manifest types into shared contracts and database/benchmark operations into a private compiled Node workspace.
4. Add atomic model handling, readiness and identity checks, lock-safe lifecycle operations, and ownership-aware cleanup.
5. Replace the pnpm wrapper, remove Commander/Execa CLI code, update documentation, and verify the compiled distribution.

## Verification

- Vitest covers the Bash process contract and Node domain operations.
- Bats covers shell-native dispatch and delegation with fake executables.
- ShellCheck 0.11.0 and shfmt 3.13.1 run as pinned containers in CI.
- Existing package, storage, API, browser, license, build, and security checks remain required.
- Hardware acceptance additionally runs `doctor`, model pull/start/status, model qualification, and a completed browser game on native Linux or WSL2 with the RTX 4060.
