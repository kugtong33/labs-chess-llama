# Chess Llama Operations

Run commands as `./chess-llama ...` from a source checkout. `pnpm chess-llama -- ...` is an equivalent compatibility wrapper. An optional user-managed symlink may place `chess-llama` on `PATH`; the project never installs one automatically.

## Service lifecycle

`./chess-llama dev` checks prerequisites, migrates SQLite, starts the selected llama.cpp profile if needed, then starts the gateway and browser client. It supervises and stops only resources it started. Ctrl-C or SIGTERM performs an orderly shutdown; model weights and persisted data remain.

Default loopback services are:

| Layer | Address | Purpose |
| --- | --- | --- |
| Client | `http://127.0.0.1:5173` | Vite browser application |
| Gateway | `http://127.0.0.1:3001` | API and authoritative game state |
| llama.cpp | `http://127.0.0.1:8080` | OpenAI-compatible local inference |

Do not change the gateway host to `0.0.0.0`; the MVP is intentionally local-only.

## Complete CLI reference

| Command | Behavior |
| --- | --- |
| `dev` | Start and supervise the complete development stack. |
| `doctor [--format json\|human]` | Check Node/pnpm, Docker/Compose, util-linux (`setsid` and `script`), cached CUDA image GPU access, paths, ports, migration state, installed-model checksum, and service health. |
| `client dev` | Start only the loopback Vite development server. |
| `client build` | Build the production browser bundle. |
| `client serve` | Preview the built browser bundle on loopback. |
| `gateway dev` | Run the TypeScript gateway with the resolved XDG database. |
| `gateway start` | Run the built gateway with the resolved XDG database. Build first. |
| `gateway health [--format json\|human]` | Query `GET /api/health`. |
| `model pull [--profile ID]` | Pull the pinned CUDA image, download the profile, and verify its SHA-256. |
| `model start [--profile ID]` | Verify weights, recreate the model container, wait for health, and verify the loaded filename. |
| `model stop` | Stop and remove only the managed model container; preserve weights. |
| `model status [--format json\|human]` | Report container, health, model/profile, and port state. |
| `model logs` | Report llama.cpp container logs in the established JSON result envelope and preserve Compose's failing exit status. |
| `model benchmark [--profile ID ...] [--format json\|human]` | Verify, start, and identity-check each installed profile; qualify it; and save a JSON report. |
| `db migrate` | Apply checked-in SQLite migrations. |
| `db status [--format json\|human]` | Report current/expected versions and pending state. |
| `db backup` | Create an online, timestamped SQLite backup and print its path. |

Stable exit codes are: `0` success, `1` unexpected failure or failed model qualification, `2` invalid input/configuration, `3` missing prerequisite, `4` runtime start failure, `5` health failure, and `6` storage/migration failure.

`doctor --format human` groups required startup checks separately from optional runtime status and prints remediation steps for blocking failures. Status markers use color only when stdout is an eligible terminal; redirected output, `TERM=dumb`, and the `NO_COLOR` environment variable produce plain text. The default `doctor` output remains JSON for scripts and complete diagnostic details.

## CLI logging

Operational commands print concise lifecycle logs to standard error. Each line identifies its level and component, then reports the active stage and important resolved values such as profiles, paths, images, ports, endpoints, ownership decisions, and subprocess exit codes:

```text
[INFO] model: starting runtime profile=qwen3-4b-q4-k-m file=Qwen3-4B-Q4_K_M.gguf port=8080
[OK] model: runtime ready profile=qwen3-4b-q4-k-m model=Qwen3-4B-Q4_K_M.gguf url=http://127.0.0.1:8080
```

Add the global `--verbose` option before the command to show probe decisions and shell-escaped native commands:

```bash
./chess-llama --verbose dev
./chess-llama --verbose model start --profile qwen3-4b-q4-k-m
CHESS_LLAMA_LOG_LEVEL=debug ./chess-llama doctor --format json
```

`CHESS_LLAMA_LOG_LEVEL=debug` is equivalent to `--verbose` and is useful in scripts. Report commands keep routine progress quiet unless debug logging is enabled. Their JSON or human result remains on standard output; lifecycle and error context use standard error, so redirection and pipelines remain reliable. Debug rendering removes URL credentials, queries, fragments, and secret-like argument values.

Log markers use color only when standard error is an eligible terminal. Set `NO_COLOR` or `TERM=dumb`, or redirect standard error, for plain text. The CLI does not persist or rotate lifecycle logs; native Vite, Node, Docker, and curl streams remain unchanged.

## Decision-trace teaching view

The browser Decision pipeline presents a correlated five-layer AI turn:
request, gateway, Stockfish, llama, and persistence. It shows only curated
candidate, retry, selection, commentary, and metric data; it never exposes
prompts, raw UCI traffic, provider response bodies, secrets, database
contents, or hidden reasoning.

`./chess-llama dev` enables tracing by default; set
`CHESS_LLAMA_DEMO_TRACE=0` to disable it. Direct gateway processes remain
disabled unless the variable is `1` or `true`. The browser reconnects using
native EventSource behavior and falls back to persisted AI decisions when the
stream is disabled or unavailable. `./chess-llama logs follow` consumes the
same curated feed; `./chess-llama model logs` remains separate raw
operational output.

## Local paths

| Data | Default | Override |
| --- | --- | --- |
| Operational config location | `${XDG_CONFIG_HOME:-~/.config}/chess-llama/config.json` | `CHESS_LLAMA_CONFIG_FILE` |
| SQLite database | `${XDG_DATA_HOME:-~/.local/share}/chess-llama/chess-llama.sqlite` | `CHESS_LLAMA_DATABASE_FILE` |
| Backups | `${XDG_DATA_HOME:-~/.local/share}/chess-llama/backups/` | `CHESS_LLAMA_BACKUPS_DIR` |
| Benchmark reports | `${XDG_DATA_HOME:-~/.local/share}/chess-llama/benchmarks/` | `CHESS_LLAMA_BENCHMARKS_DIR` |
| Model weights | `${XDG_CACHE_HOME:-~/.cache}/chess-llama/models/` | `CHESS_LLAMA_MODEL_DIR` |
| Compose file | `<repository>/infra/compose.yaml` | `CHESS_LLAMA_COMPOSE_FILE` |

Overrides must be absolute paths; a relative override is ignored in favor of the default. User-facing theme, orientation, commentary style, Stockfish limits, and preferred model profile are stored in SQLite. The config-file location is reserved for operational configuration; this MVP's active path overrides are environment variables.

## Backup and restore

Create a consistent online backup while the app is running:

```bash
./chess-llama db backup
```

The command prints the exact destination. To restore:

1. Stop `dev` and ensure no standalone gateway process is running.
2. Preserve the current database with `./chess-llama db backup` before shutdown, or copy it to a uniquely named recovery file.
3. Resolve the active database path and chosen backup path exactly; do not restore using a wildcard.
4. Copy the chosen backup over the database file, retaining owner permissions.
5. Run `./chess-llama db migrate`, then `./chess-llama db status`.
6. Start the stack and open the history screen to verify the expected games.

SQLite `-wal` and `-shm` sidecars must not be copied from a live database. The online backup command is the supported way to capture live state.

## Changing or restarting models

Changing the preferred profile requires a restart because the llama.cpp container loads one GGUF at startup:

```bash
./chess-llama model pull --profile qwen3-1.7b-q4-k-m
./chess-llama model stop
./chess-llama model start --profile qwen3-1.7b-q4-k-m
./chess-llama model status --format human
./chess-llama model benchmark --profile qwen3-1.7b-q4-k-m
```

The 1.7B profile remains experimental even if it starts successfully; promote it only after [model qualification](model-benchmark.md).

## Troubleshooting

- `doctor` says Docker is unavailable: start Docker Engine/Desktop and verify `docker info` and `docker compose version` from the same Linux or WSL2 shell.
- GPU check fails: verify `nvidia-smi`; on native Linux install/configure NVIDIA Container Toolkit, then restart Docker. On WSL2 update the Windows NVIDIA driver, enable WSL integration for the distro, run `wsl --update`, and restart WSL/Docker Desktop.
- GPU check reports a missing image: run `model pull`; `doctor` uses `--pull never` by design.
- Port 5173, 3001, or 8080 is in use: stop the owning local process/container. Do not expose an alternate public bind as a shortcut.
- Model start times out: inspect `model logs`, confirm the profile checksum with `doctor`, check GPU memory/driver errors, and retry `model stop` then `model start`.
- Model filename mismatch: stop the container and start the intended explicit profile. The CLI refuses to accept a healthy server carrying the wrong model.
- Gateway reports pending migration/storage failure: stop standalone gateways, run `db status`, take a backup, then run `db migrate`.
- WSL2 cannot reach the UI: open `http://127.0.0.1:5173` from Windows; confirm the Vite process is still running inside the intended distro and that no VPN/security product blocks localhost forwarding.

## Local teardown

First stop managed processes and the container:

```bash
./chess-llama model stop
```

Stop any foreground client/gateway with Ctrl-C. For a recoverable teardown, rename the exact `chess-llama` data and config directories after verifying their resolved paths. This removes games, settings, backups, reports, and operational configuration from active use. Leave `${XDG_CACHE_HOME:-~/.cache}/chess-llama/models/` untouched—the default teardown preserves downloaded weights. Delete that model directory only when you intentionally want to reclaim the model storage and are willing to download it again.
