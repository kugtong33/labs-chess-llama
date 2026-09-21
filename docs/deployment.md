# Compose Deployment

## Runtime architecture

Each service has one clear responsibility:

The root [`compose.yaml`](../compose.yaml) runs exactly four services:

| Service | Responsibility | Host access |
| --- | --- | --- |
| `nginx` | Gateway and reverse proxy | `127.0.0.1:${NGINX_PORT}` |
| `web` | Serves the built React chess game | Internal only (`4173`) |
| `backend` | API, chess rules, Stockfish, and SQLite | Internal only (`3001`) |
| `llama` | GGUF verification/download and llama.cpp inference | Internal only (`8080`) |

Nginx sends `/api` traffic to backend and all other traffic to web. Backend calls llama directly over the Compose network. Run every command below from the repository root.

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

The development topologies expose loopback services directly and do not run
Nginx. The deployment topology runs all four responsibilities in Docker and
exposes only Nginx.

## Requirements

Complete the full-runtime path in the [setup guide](setup.md) before starting
Compose. The supported hosts are Ubuntu 24.04 LTS with Docker Engine and NVIDIA
Container Toolkit, or Windows with Ubuntu 24.04 on WSL2 and Docker Desktop's
WSL integration. Both require a supported NVIDIA GPU and a working
`nvidia-smi` check.

The Compose deployment is Linux/WSL2-only. Apple Silicon macOS supports the
native Metal development runtime, but not this CUDA deployment. The setup guide
is the canonical source for platform installation commands and verification.

## Configuration

The committed `.env` contains the complete public configuration surface:

| Setting | Default | Meaning |
| --- | --- | --- |
| `NGINX_PORT` | `5173` | Loopback port for the whole application |
| `BACKEND_LOG_LEVEL` | `info` | Backend log level |
| `BACKEND_DEMO_TRACE` | `false` | Enables the curated teaching event stream |
| `LLAMA_PROFILE_ID` | `qwen3-4b-q4-k-m` | Model profile from the runtime manifest |
| `LLAMA_CONTEXT_SIZE` | `4096` | llama.cpp context size |
| `LLAMA_GPU_LAYERS` | `99` | Layers offloaded to the GPU |

Image pins, container paths, service names, and internal ports are implementation details beside their owning Dockerfiles or in `compose.yaml`; they are intentionally not duplicated as environment variables.

## Start and inspect

Build and start the complete application:

```bash
docker compose up --build -d
docker compose ps
```

The first run can take several minutes. Docker builds the four service images, then llama downloads the selected GGUF to the `models` volume, verifies its SHA-256, and starts inference. Backend waits for llama health; Nginx waits for web and backend health.

Open <http://127.0.0.1:5173>. The application health endpoint is available through the gateway:

```bash
curl -fsS http://127.0.0.1:5173/api/health
```

Backend and llama intentionally have no host ports. Inspect their health and logs through Docker:

```bash
docker compose ps
docker compose logs --tail=200 nginx
docker compose logs --tail=200 web
docker compose logs --tail=200 backend
docker compose logs --tail=200 llama
```

Add `-f` to follow a stream. A failed or interrupted llama download leaves any valid cached `current.gguf` intact; fix the reported network, disk, manifest, checksum, GPU, or driver problem and start again.

## Restart, update, and persistence

An ordinary restart preserves both named volumes:

```bash
docker compose down
docker compose up --build -d
```

The `database` volume owns games and settings. The `models` volume owns verified model weights. There are no source, workspace, package-manager, or Nginx configuration mounts.

```bash
docker volume ls --filter label=com.docker.compose.project=chess-llama
docker compose config --quiet
```

Only use the following command when intentionally discarding all Compose-managed games, settings, and models:

```bash
docker compose down -v
```

## Native development mode

`./chess-llama dev` runs Vite and backend directly on the host. Linux/WSL2 runs
llama.cpp in Docker with CUDA; Apple Silicon runs the Homebrew `llama-server`
directly with Metal. Nginx is not part of either development topology.

Compose instead runs all four services in Docker and exposes only Nginx. On
Linux/WSL2, do not run Compose beside `dev`: they compete for port `5173` and
the local GPU, and they keep separate SQLite/model state. See the
[setup guide](setup.md#project-setup-all-supported-development-hosts) for the
development first-run sequence.

## Real-GPU acceptance smoke

After all four services are healthy:

1. Open the chess game through Nginx.
2. Create a game and make a legal move, such as `e2` to `e4`.
3. Wait for the LLM-selected response and commentary.
4. Record a game or settings value.
5. Run the data-preserving restart above and confirm the state remains.
6. Run `docker compose down` when finished; do not use `down -v` for normal acceptance.
