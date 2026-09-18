# Bash CLI Design

Chess Llama has one public control plane: the executable `./chess-llama`. It is a Bash 5 program split into focused modules under `scripts/cli/`. The root executable resolves the repository from `BASH_SOURCE`, so it can be invoked from any working directory.

## Responsibility boundary

Bash owns public command parsing, help, exit-code mapping, XDG paths, Docker Compose, curl requests, downloads, checksums, locks, process supervision, signals, and output selection. Commands invoke the applications through their native tools:

- React uses Vite through pnpm.
- The Fastify gateway uses Node directly; development adds the tsx loader, while `start` requires compiled JavaScript.
- llama.cpp uses the digest-pinned Docker Compose service.
- Health and model discovery use curl.
- GGUF integrity uses sha256sum.

The private `@chess-llama/operations` workspace contains fixed-purpose Node entrypoints for SQLite, runtime-manifest validation, and the chess benchmark. They exchange JSON with Bash and do not expose another user-facing command tree.

## Safety and lifecycle

The CLI uses strict Bash, quoted expansions, command arrays, absolute project paths, loopback-only services, and no `eval` or generated shell sourcing. Model mutations use `flock`; downloads use a same-directory `.partial` file, SHA-256 verification, invalid-file quarantine, and atomic rename. Model startup waits at most 120 seconds and accepts the runtime only when `/v1/models` reports the expected GGUF filename.

`dev` checks prerequisites, migrates SQLite, reuses healthy pre-existing services, and tracks only resources it starts. Gateway and client children run in isolated `setsid` process groups so cleanup reaches their full Node process trees. SIGINT, SIGTERM, or a managed child exit triggers reverse cleanup: client, gateway, then the model container. Persisted games, settings, reports, backups, and model weights remain on disk.

## Portability

The supported environments are native Linux and WSL2. Runtime requirements are Bash 5+, Node 24, the exact pnpm version declared by the root `package.json`, Docker Compose, curl, sha256sum, util-linux (`flock`, `setsid`, and `script`), `ss`, and standard GNU userland. NVIDIA Container Toolkit is required for the llama.cpp CUDA container. The implementation avoids adding jq or the sqlite3 CLI because Node and the existing storage package already provide validated JSON and SQLite operations.
