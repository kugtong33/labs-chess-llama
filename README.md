# Chess Llama

## Overview

Chess Llama is a local browser chess game that showcases llama.cpp on consumer
hardware. Stockfish performs a short CPU search and returns up to five credible
legal moves; a quantized Qwen3 model chooses one and writes the commentary. The
LLM selects every AI move that is applied—there is no random or silent engine
fallback.

See the [deployment guide](docs/deployment.md) for service boundaries and
runtime topologies, the [operations guide](docs/operations.md) for the CLI and
decision tracing, and the
[model qualification guide](docs/model-benchmark.md) for model profile policy.

## Platform Support

| Platform                                         | `./chess-llama dev`           | Docker Compose                   |
| ------------------------------------------------ | ----------------------------- | -------------------------------- |
| Ubuntu 24.04 with NVIDIA GPU                     | Docker llama.cpp with CUDA    | Supported                        |
| Windows with Ubuntu 24.04 on WSL2 and NVIDIA GPU | Docker llama.cpp with CUDA    | Supported through Docker Desktop |
| Apple Silicon macOS                              | Homebrew llama.cpp with Metal | Not supported                    |
| Intel macOS                                      | Not supported                 | Not supported                    |

Apple Silicon development works best with at least 16 GB of unified memory.
Other Linux distributions may work, but Ubuntu 24.04 is the maintained Linux
path.

## Configuration Settings

The committed `.env` defines the complete public configuration surface for the
four-container deployment:

| Setting              | Default           | Meaning                                   |
| -------------------- | ----------------- | ----------------------------------------- |
| `NGINX_PORT`         | `5173`            | Loopback port for the application         |
| `BACKEND_LOG_LEVEL`  | `info`            | Backend log level                         |
| `BACKEND_DEMO_TRACE` | `false`           | Enables the curated teaching event stream |
| `LLAMA_PROFILE_ID`   | `qwen3-4b-q4-k-m` | Model profile from the runtime manifest   |
| `LLAMA_CONTEXT_SIZE` | `4096`            | llama.cpp context size                    |
| `LLAMA_GPU_LAYERS`   | `99`              | Layers offloaded to the NVIDIA GPU        |

Edit `.env` before running Docker Compose. Development mode uses XDG-compliant
paths and platform-aware runtime defaults documented in the
[operations guide](docs/operations.md#local-paths).

## Prerequisite Installation

Install the prerequisites for one supported platform. The
[setup guide](docs/setup.md) contains the complete driver, Docker, Homebrew,
verification, and troubleshooting procedures.

### Ubuntu 24.04 with NVIDIA GPU

Install the host tools and NVIDIA driver:

```bash
sudo apt update
sudo apt install -y \
  ca-certificates curl git gnupg build-essential python3 util-linux \
  ubuntu-drivers-common
sudo ubuntu-drivers install
```

Reboot, verify `nvidia-smi`, then install Docker Engine with the Compose plugin
and NVIDIA Container Toolkit as described in the setup guide.

### Windows with WSL2 and NVIDIA GPU

In an administrator PowerShell terminal:

```powershell
wsl --install -d Ubuntu-24.04
wsl --update
wsl --set-default-version 2
```

Install the Windows NVIDIA driver and Docker Desktop, enable Docker Desktop's
WSL integration for Ubuntu 24.04, then run inside Ubuntu:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git build-essential python3 util-linux
```

Keep the checkout in the WSL filesystem rather than under `/mnt/c`.

### Apple Silicon macOS

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
brew install bash git llama.cpp
```

Verify that `uname -m` prints `arm64`, Bash is version 5 or newer, and
`llama-server --list-devices` includes a Metal device.

### Node.js 24 on every platform

Run these commands in Bash after installing the platform prerequisites:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
```

## Quick Start

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
started by that invocation while preserving models, games, and settings.

## Container Deployment

The four-container deployment is supported on configured Ubuntu or WSL2 hosts
with an NVIDIA GPU. It runs `nginx`, `web`, `backend`, and `llama`; Nginx is
the only service with a published host port.

```bash
docker compose up --build -d
docker compose ps
```

Open <http://127.0.0.1:5173>. Do not run Compose beside
`./chess-llama dev`; both use port `5173` and the local GPU.

```bash
docker compose down
```

This preserves the SQLite database and downloaded model. Only use
`docker compose down -v` when intentionally deleting all Compose-managed games,
settings, and model weights. See the
[deployment guide](docs/deployment.md) for health checks, logs, updates, and
recovery.

## License

Chess Llama is GPL-3.0. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Distributions containing
Stockfish.js must preserve GPL notices and corresponding-source obligations.
