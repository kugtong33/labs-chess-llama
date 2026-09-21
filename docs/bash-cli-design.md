# Bash CLI Design

Chess Llama has one public control plane: `./chess-llama`. It is a Bash 5
program split into focused modules under `scripts/cli/`. The root executable
resolves the repository from `BASH_SOURCE`, so it works from any directory.

## Responsibility boundary

Bash owns public command parsing, help, exit-code mapping, XDG paths, provider
routing, lifecycle messages, and application launch. Commands use each
component's native interface:

- React uses Vite through pnpm.
- Backend uses Node directly; development adds the tsx loader.
- Linux/WSL2 llama.cpp uses the digest-pinned Docker/CUDA service.
- Apple Silicon llama.cpp uses the Homebrew `llama-server` with Metal.
- Health and model discovery use curl.

The private `@chess-llama/operations` workspace contains fixed-purpose Node
entrypoints for SQLite, runtime-manifest validation, portable artifact hashing
and installation, host/provider detection, native process state, child
supervision, and the chess benchmark. They exchange JSON with Bash and do not
expose another user-facing command tree.

## Provider selection

Host detection makes the choice directly: Linux selects `docker-cuda`; Darwin
on `arm64` selects `native-metal`; unsupported hosts fail with a remediation.
The user does not translate provider names into environment variables.

Both providers implement the same public model operations: pull, start, stop,
status, logs, and benchmark. Status reports provider, runtime state, health,
loaded model/profile, and port. Backend receives the literal accelerator label
`CUDA` or `Metal` for health telemetry.

## Safety and lifecycle

The CLI uses strict Bash, quoted expansions, command arrays, absolute project
paths, loopback-only services, and no `eval` or generated shell sourcing.
Downloads use a same-directory partial file, SHA-256 verification, invalid-file
quarantine, and atomic rename.

Docker model mutations use `flock`. Native model mutations use the portable
Node lock and store PID, launch command, and process-start identity below the
XDG state directory. Stop refuses to signal a stale or mismatched process. A
healthy native server not started by Chess Llama is classified as `external`,
reused when its model matches, and never stopped by the CLI.

`dev` checks prerequisites, migrates SQLite, reuses healthy services, and
tracks only resources it starts. A portable Node supervisor owns the web and
backend process trees. SIGINT, SIGTERM, or a managed child exit triggers reverse
cleanup: web, backend, then the owned model runtime. Persisted games, settings,
reports, backups, and model weights remain on disk.

## Portability

Shared requirements are Bash 5+, Node 24, the exact pnpm version declared by
the root package, and curl. Linux/WSL2 additionally requires Docker Compose,
`flock`, and NVIDIA Container Toolkit. Apple Silicon requires `arm64` macOS and
a Homebrew llama.cpp whose `llama-server` exposes the required server flags and
a Metal device.

Portable Node helpers replace GNU-specific hashing, artifact streaming,
process-group discovery, and port-owner probes. The implementation avoids jq
and the sqlite3 CLI because Node and the existing storage package already
provide validated JSON and SQLite operations.
