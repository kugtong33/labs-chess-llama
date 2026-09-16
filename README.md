# Chess Llama

Chess Llama is a local browser chess game built to showcase llama.cpp on a consumer NVIDIA GPU. It uses an honest hybrid design: Stockfish performs a short CPU search and returns up to five credible legal moves; a quantized Qwen3 model running in llama.cpp must choose one of those moves and write the commentary. The LLM selects every AI move that is applied—there is no random or silent engine fallback.

```text
React client (5173) -> Fastify gateway (3001) -> SQLite
                              |-> Stockfish.js shortlist on CPU
                              `-> llama.cpp server (8080) on CUDA
```

The gateway owns chess rules, turn serialization, validation, and persistence. Games and settings survive restarts in SQLite. Browser, gateway, and model ports bind to `127.0.0.1` only.

## Requirements

- Native Linux or WSL2 on Windows
- NVIDIA RTX 4060-class GPU with a working driver
- Docker Engine with Compose and NVIDIA Container Toolkit support; on WSL2, Docker Desktop with WSL integration is supported
- Node.js 24 and Corepack
- Enough disk space for dependencies, the pinned container, and a GGUF model

Verify that `nvidia-smi` works first. On WSL2, also verify `docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu24.04 nvidia-smi` before debugging the application.

## Quick start

```bash
corepack enable
corepack prepare pnpm@11.5.1 --activate
pnpm install --frozen-lockfile
pnpm build

# Before the first pull, this usefully reports host issues and an expected
# model-installed failure.
pnpm chess-llama doctor --format human

pnpm chess-llama model pull --profile qwen3-4b-q4-k-m
pnpm chess-llama doctor --format human
pnpm chess-llama dev
```

Open <http://127.0.0.1:5173>. Press Ctrl-C once to stop the client, gateway, and any model container started by that `dev` invocation. The downloaded weights are retained.

`pnpm chess-llama ...` runs the single namespaced CLI directly from the workspace. After packaging or linking `apps/cli`, its executable name is `chess-llama`, with the same commands—for example `chess-llama client dev`, `chess-llama gateway start`, and `chess-llama model status`.

## Model profiles

- `qwen3-4b-q4-k-m` is the default: Qwen3-4B Q4_K_M, selected as the smallest currently recommended profile for credible constrained choices and short commentary on the RTX 4060.
- `qwen3-1.7b-q4-k-m` is smaller and experimental. Do not make it the default unless it independently passes the automated benchmark and human commentary review in [docs/model-benchmark.md](docs/model-benchmark.md).

Model artifacts and the llama.cpp CUDA image are pinned by digest/checksum in `config/runtime-manifest.json`. `model pull` verifies the GGUF SHA-256 before installation.

## Offline use

Network access is needed for the first dependency install, container pull, and model pull. After those artifacts exist locally, normal play is local and does not call a hosted AI service. `doctor` deliberately runs its GPU check with Docker `--pull never`, so it does not hide a missing local image by fetching one.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm notices
git diff --exit-code THIRD_PARTY_NOTICES.md
```

Normal CI uses a deterministic fake llama.cpp HTTP server and temporary SQLite database. It requires no Docker, GPU, network model download, or model weights. Real RTX 4060 qualification is a separate, documented acceptance run.

See [docs/operations.md](docs/operations.md) for lifecycle, backup/restore, troubleshooting, paths, and teardown.

## License

Chess Llama is GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). In particular, distributions containing Stockfish.js must preserve GPL notices and corresponding-source obligations.
