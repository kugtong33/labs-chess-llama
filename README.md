# Chess Llama

Chess Llama is a local browser chess game that showcases llama.cpp on consumer
hardware. Stockfish performs a short CPU search and returns up to five credible
legal moves; a quantized Qwen3 model must choose one and write the commentary.
The LLM selects every AI move that is applied—there is no random or silent
engine fallback.

## Runtime architecture

Each service has one clear responsibility:

- **nginx** is the gateway and reverse proxy for the container deployment.
- **web** serves the React chess game and sends `/api` requests to backend.
- **backend** owns the API, chess rules, Stockfish, turn serialization,
  validation, and SQLite; it sends inference requests to llama.
- **llama** verifies the selected GGUF and provides local llama.cpp inference.

### Linux/WSL2 development

```text
Browser -> web / Vite (127.0.0.1:5173)
              `-> /api -> backend (127.0.0.1:3001)
                              |-> SQLite + Stockfish
                              `-> Docker llama.cpp / CUDA (127.0.0.1:8080)
```

### Apple Silicon development

```text
Browser -> web / Vite (127.0.0.1:5173)
              `-> /api -> backend (127.0.0.1:3001)
                              |-> SQLite + Stockfish
                              `-> native llama-server / Metal (127.0.0.1:8080)
```

### Four-container deployment

```text
Browser -> nginx (127.0.0.1:5173)
             |-> web
             `-> /api -> backend -> llama.cpp / CUDA
```

Docker Compose runs `nginx`, `web`, `backend`, and `llama` as separate
containers. Nginx is the only published service. This deployment is for
Linux/WSL2 with NVIDIA GPU support; macOS uses the native development topology.

## Platform support

| Platform                                         | `./chess-llama dev`           | Docker Compose                   |
| ------------------------------------------------ | ----------------------------- | -------------------------------- |
| Ubuntu 24.04 with NVIDIA GPU                     | Docker llama.cpp with CUDA    | Supported                        |
| Windows with Ubuntu 24.04 on WSL2 and NVIDIA GPU | Docker llama.cpp with CUDA    | Supported through Docker Desktop |
| Apple Silicon macOS                              | Homebrew llama.cpp with Metal | Not supported                    |
| Intel macOS                                      | Not supported                 | Not supported                    |

Follow the [setup guide](docs/setup.md) for copy-paste prerequisites for Linux,
macOS, and Windows with WSL2.

## Quick start

After completing the prerequisites for your platform:

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
<http://127.0.0.1:5173>. Ctrl-C stops the web app, backend, and any model runtime
started by that `dev` invocation. It does not stop a healthy native llama-server
that was already running. Model weights and application data remain on disk.

See [setup](docs/setup.md#project-setup-all-supported-development-hosts) for
first-run details and [operations](docs/operations.md) for the complete command
reference.

## Student decision tracing

The play screen includes a five-stage Decision pipeline: request, backend,
Stockfish, llama, and saved decision. It streams curated teaching evidence and
falls back to persisted decisions after refresh or when tracing is unavailable.
It never renders raw prompts, raw UCI traffic, provider bodies, secrets, or
private reasoning.

`./chess-llama dev` enables tracing unless `CHESS_LLAMA_DEMO_TRACE=0`.
Use `./chess-llama logs follow` for the terminal view. `model logs` is separate
raw llama.cpp operational output and is not browser teaching data.

## Container deployment

On a configured Linux or WSL2 NVIDIA host:

```bash
docker compose up --build -d
docker compose ps
```

Open <http://127.0.0.1:5173>. Backend and llama have no host ports. Compose and
`./chess-llama dev` should not run together because both use port `5173` and
the local GPU. `docker compose down` preserves SQLite data and weights;
`docker compose down -v` intentionally removes Compose-managed data. See the
[deployment guide](docs/deployment.md).

## Model profiles

- `qwen3-4b-q4-k-m` is the recommended default for credible constrained move
  choices and short commentary.
- `qwen3-1.7b-q4-k-m` is smaller and experimental. Promote it only after the
  automated benchmark and human review in
  [model qualification](docs/model-benchmark.md).

GGUF artifacts are pinned by SHA-256 in `config/runtime-manifest.json`.
The Linux/WSL2 CUDA image is also pinned by digest. `model pull` verifies the
GGUF before installation on every platform.

## Offline use

Network access is needed for the initial dependency and model downloads, and
for the Linux/WSL2 container image pull. Apple Silicon also needs the Homebrew
llama.cpp formula installed. After those artifacts exist locally, normal play
does not call a hosted AI service.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Linux CI additionally validates Compose, Dockerfiles, container security, and
browser acceptance. macOS CI validates the native Metal provider's portable
code and shell behavior, but GitHub-hosted CI does not qualify real model
inference. Run the documented hardware acceptance on an actual NVIDIA or Apple
Silicon machine.

## License

Chess Llama is GPL-3.0. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Distributions containing
Stockfish.js must preserve GPL notices and corresponding-source obligations.
