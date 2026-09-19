# Chess Llama

Chess Llama is a local browser chess game built to showcase llama.cpp on a consumer NVIDIA GPU. It uses an honest hybrid design: Stockfish performs a short CPU search and returns up to five credible legal moves; a quantized Qwen3 model running in llama.cpp must choose one of those moves and write the commentary. The LLM selects every AI move that is applied—there is no random or silent engine fallback.

## Runtime architecture

`./chess-llama dev` runs the development-facing services directly and uses
Docker only for llama.cpp:

```text
Browser -> web / Vite (127.0.0.1:5173)
              `-> /api proxy -> backend (127.0.0.1:3001)
                                    |-> SQLite + Stockfish
                                    `-> llama container (127.0.0.1:8080)
```

The separate Compose deployment runs all four responsibilities in containers:

```text
Browser -> nginx (127.0.0.1:5173)
             |-> web (React chess game)
             `-> /api -> backend -> SQLite + Stockfish
                                  `-> llama -> llama.cpp on CUDA
```

The responsibilities are literal in both modes: web serves the chess game,
backend owns the API, chess rules, Stockfish, turn serialization, validation,
and SQLite, and llama owns model verification plus inference. In Compose,
Nginx is the gateway and only published port. Games, settings, and model weights
survive restarts in their owning storage.

## Student decision tracing

The play screen includes a five-stage Decision pipeline: request, backend,
Stockfish, llama, and saved decision. It streams curated teaching evidence and
falls back to persisted decisions after refresh or when tracing is unavailable.
It never renders raw prompts, raw UCI traffic, provider bodies, secrets, or
private reasoning.

`./chess-llama dev` enables tracing unless `CHESS_LLAMA_DEMO_TRACE=0`.
Direct backend starts are disabled until `CHESS_LLAMA_DEMO_TRACE=1` or `true`.
Use `./chess-llama logs follow` (optionally `--layer stockfish|llama`,
`--game UUID`, or `--format json`) for the terminal view. `model logs` is
separate raw llama.cpp operational output and is not browser teaching data.

## Platform support and prerequisites

The complete runtime is supported on Ubuntu 24.04 LTS and on Windows with
Ubuntu 24.04 under WSL2. Both require a supported NVIDIA GPU. macOS supports
source development and static checks, but cannot run the CUDA llama service or
the complete game.

Follow the [setup guide](docs/setup.md) for copy-paste Linux, WSL2, and macOS
prerequisite commands. It also explains Docker/NVIDIA verification and every
required `doctor` check.

## Quick start

After completing the Ubuntu or WSL2 prerequisites, run:

```bash
git clone https://github.com/kugtong33/labs-chess-llama.git
cd labs-chess-llama
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
pnpm build
./chess-llama model pull --profile qwen3-4b-q4-k-m
./chess-llama doctor --format human
./chess-llama dev
```

`doctor` must report `READY` before `dev` starts. Open
<http://127.0.0.1:5173>. Press Ctrl-C once to stop the web app, backend, and any
model container started by that `dev` invocation. The downloaded weights are
retained. See [setup](docs/setup.md#project-setup-linux-and-wsl2) for first-run
details and remediation.

`./chess-llama ...` is the public Bash control plane and works from any current directory when invoked by absolute path or a user-managed symlink. `pnpm chess-llama -- ...` remains a compatibility wrapper. Examples include `./chess-llama web dev`, `./chess-llama backend start`, and `./chess-llama model status`.

## Container deployment

With Docker Compose and NVIDIA container GPU support installed, start the separate local deployment from the repository root with:

```bash
docker compose up --build -d
```

The first start builds the four service images and verifies/downloads the GGUF before llama.cpp starts. Inspect it with `docker compose ps`, then open <http://127.0.0.1:5173>. API requests use the same origin under `/api`; backend and llama have no host ports.

Compose and `./chess-llama dev` should not run at the same time because both use port `5173` and compete for the local GPU. Compose keeps its SQLite data and model weights in named volumes separate from native CLI XDG data. Use `docker compose down` for a normal, data-preserving stop; `docker compose down -v` intentionally removes all Compose-managed data. See [docs/deployment.md](docs/deployment.md) for prerequisites, per-service logs, startup recovery, updates, and persistence verification.

## Model profiles

- `qwen3-4b-q4-k-m` is the default: Qwen3-4B Q4_K_M, selected as the smallest currently recommended profile for credible constrained choices and short commentary on the RTX 4060.
- `qwen3-1.7b-q4-k-m` is smaller and experimental. Do not make it the default unless it independently passes the automated benchmark and human commentary review in [docs/model-benchmark.md](docs/model-benchmark.md).

Model artifacts and the llama.cpp CUDA image are pinned by digest/checksum in `config/runtime-manifest.json`. `model pull` verifies the GGUF SHA-256 before installation.

## Offline use

Network access is needed for the first dependency install, container pull, and model pull. After those artifacts exist locally, normal play is local and does not call a hosted AI service. `doctor` deliberately runs its GPU check with Docker `--pull never`, so it does not hide a missing local image by fetching one.

## Verification

```bash
pnpm format:check
pnpm format:shell:check
pnpm lint
pnpm lint:shell
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm notices
git diff --exit-code THIRD_PARTY_NOTICES.md
```

Normal CI uses a deterministic fake llama.cpp HTTP server and temporary SQLite database. The deployment configuration tests require the Docker Compose CLI, but CI requires no GPU, network model download, or model weights. Real RTX 4060 qualification is a separate, documented acceptance run.

CI also rejects unreviewed production licenses and high-severity production dependency findings, validates `compose.yaml` and all four Dockerfiles, and scans every unique digest-pinned base image discovered from those Dockerfiles for high and critical OS/library vulnerabilities.

See [docs/operations.md](docs/operations.md) for native CLI lifecycle, backup/restore, troubleshooting, paths, and teardown, and [docs/deployment.md](docs/deployment.md) for Compose operations.

## License

Chess Llama is GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). In particular, distributions containing Stockfish.js must preserve GPL notices and corresponding-source obligations.
