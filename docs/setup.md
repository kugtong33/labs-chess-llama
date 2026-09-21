# Setup

This guide prepares a new machine for `./chess-llama dev`. Complete one
platform section, install Node.js 24, then follow the shared project setup.

## Platform support

| Platform | Development runtime | Docker Compose deployment |
| --- | --- | --- |
| Ubuntu 24.04 with NVIDIA GPU | Docker llama.cpp with CUDA | Supported |
| Windows 10/11, Ubuntu 24.04 on WSL2, and NVIDIA GPU | Docker llama.cpp with CUDA | Supported through Docker Desktop |
| Apple Silicon macOS | Native Homebrew llama.cpp with Metal | Not supported |
| Intel macOS | Not supported | Not supported |

The default Qwen3-4B Q4_K_M profile needs several gigabytes of disk. On Apple
Silicon, **16 GB of unified memory or more is recommended** so the model, the
operating system, and the web/backend processes fit comfortably.

Network access is required for the first dependency and model downloads. Linux
and WSL2 also download the pinned CUDA container image; macOS installs the
native llama.cpp executable through Homebrew.

## Ubuntu 24.04 LTS

Other Linux distributions may work, but Ubuntu 24.04 is the maintained path.

### 1. Install host tools and the NVIDIA driver

```bash
sudo apt update
sudo apt install -y \
  ca-certificates curl git gnupg build-essential python3 util-linux \
  ubuntu-drivers-common
sudo ubuntu-drivers install
sudo reboot
```

After rebooting:

```bash
nvidia-smi
```

Do not continue until the driver reports the GPU. If Secure Boot requests
Machine Owner Key enrollment, complete it during the reboot. See Ubuntu's
[NVIDIA driver guide](https://help.ubuntu.com/community/NvidiaDriversInstallation).

### 2. Install Docker Engine and Compose

Remove conflicting packages, add Docker's official repository, and install the
engine and Compose plugin:

```bash
for package in \
  docker.io docker-compose docker-compose-v2 docker-doc docker-buildx \
  podman-docker containerd runc; do
  sudo apt remove -y "$package"
done

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
  docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Sign out and back in after adding the group. Membership in the `docker` group
grants root-level privileges; review Docker's
[Linux post-install guidance](https://docs.docker.com/engine/install/linux-postinstall/).
Then verify:

```bash
docker info
docker compose version
```

These steps follow Docker's
[Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).

### 3. Install NVIDIA Container Toolkit

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor --yes \
    -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L \
  https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null

sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
docker info
```

See NVIDIA's
[Container Toolkit installation guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).
Continue with [Node.js 24](#install-nodejs-24).

## Windows with WSL2

Run the application inside Ubuntu, not PowerShell. Windows owns the NVIDIA
driver and Docker Desktop; Ubuntu owns the checkout, Node.js, pnpm, and project
commands.

### 1. Install Ubuntu 24.04 on WSL2

Open **PowerShell as Administrator**:

```powershell
wsl --list --online
wsl --install -d Ubuntu-24.04
wsl --update
wsl --set-default-version 2
wsl --list --verbose
```

Restart if prompted. The Ubuntu row must show version `2`. See Microsoft's
[WSL installation guide](https://learn.microsoft.com/windows/wsl/install).

### 2. Install the Windows NVIDIA driver

Install a current NVIDIA Windows driver with WSL2 CUDA support and restart
Windows. Follow NVIDIA's [CUDA on WSL guide](https://docs.nvidia.com/cuda/wsl-user-guide/).
Do not install a Linux NVIDIA display driver inside Ubuntu. Verify in Ubuntu:

```bash
nvidia-smi
```

### 3. Install and enable Docker Desktop

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Enable **Use the WSL 2 based engine**.
3. Under **Resources → WSL Integration**, enable Ubuntu 24.04.
4. Keep Docker Desktop running while using Chess Llama.

Do not install Docker Engine or NVIDIA Container Toolkit inside Ubuntu; Docker
Desktop supplies them. In the Ubuntu shell, verify:

```bash
docker info
docker compose version
```

### 4. Install Ubuntu command-line tools

```bash
sudo apt update
sudo apt install -y \
  ca-certificates curl git build-essential python3 util-linux
```

Keep the checkout in the WSL filesystem, such as
`~/src/labs-chess-llama`, rather than below `/mnt/c`. Continue with
[Node.js 24](#install-nodejs-24), running all remaining commands in Ubuntu.

## Apple Silicon macOS

Apple Silicon development uses the native `llama-server` installed by
Homebrew. llama.cpp uses Metal for GPU acceleration; Docker Desktop is not
needed for `./chess-llama dev` and cannot run the CUDA Compose deployment.
Intel Macs are not supported.

### 1. Install Apple tools, Homebrew, Bash, and llama.cpp

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"
brew install bash git llama.cpp
```

Follow Homebrew's printed instruction to add `brew shellenv` permanently to
your shell profile. The formula is intentionally not pinned because Homebrew
maintains compatible Apple Silicon bottles; `doctor` verifies the executable's
required capabilities. See the official
[llama.cpp install guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md),
[Metal build notes](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md#metal-build),
and [Homebrew formula](https://formulae.brew.sh/formula/llama.cpp).

### 2. Verify the native runtime

```bash
uname -m
bash --version
llama-server --help
llama-server --list-devices
```

`uname -m` must print `arm64`, Bash must be version 5 or newer, and the device
list must include a Metal device. Keep Homebrew's shell environment active so
the `#!/usr/bin/env bash` launcher resolves Homebrew Bash instead of Apple's
older `/bin/bash`.

Continue with [Node.js 24](#install-nodejs-24).

## Install Node.js 24

Use nvm on Ubuntu, WSL2, or macOS:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
node --version
```

The last command must print `v24.x.x`. The command is pinned to nvm's
[published installer](https://github.com/nvm-sh/nvm#installing-and-updating).

## Project setup: all supported development hosts

Run in Bash after completing the matching platform prerequisites:

```bash
mkdir -p "$HOME/src"
cd "$HOME/src"
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

If the repository is already cloned, start at its root. `model pull` downloads
and verifies the GGUF on every platform. On Linux/WSL2 it also builds and pulls
the pinned CUDA image; on macOS it uses the Homebrew `llama-server` already on
the host. `doctor` must print:

```text
Status: READY (all required checks passed)
```

Open <http://127.0.0.1:5173>. Ctrl-C stops resources started by that invocation
while preserving models, games, and settings.

## Offline use

Network access is required for the initial dependency and model downloads.
Linux and WSL2 also pull the pinned CUDA image, while Apple Silicon installs
llama.cpp through Homebrew. After those artifacts are installed, normal play
uses only local Stockfish and llama.cpp processes and does not call a hosted AI
service.

## Project verification

Run the maintained source checks from the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Linux CI additionally validates Compose, Dockerfiles, container security, and
browser acceptance. macOS CI validates the native Metal provider's portable
code and shell behavior. Neither CI path replaces the real-hardware acceptance
below.

## What `doctor` checks

All platforms check Bash 5, Node.js 24, the package.json pnpm version, curl,
writable data paths, the selected model checksum, ports, migrations, and
service health.

- Linux/WSL2 additionally checks Docker, Compose, `flock`, the pinned CUDA
  image, and NVIDIA GPU access from that image.
- Apple Silicon checks `arm64`, `llama-server`, required server options, and a
  Metal device reported by `llama-server --list-devices`.

Pre-start model and backend health may appear as non-blocking warnings.

## Real-hardware acceptance

GitHub-hosted CI checks macOS packaging and the native lifecycle with fakes; it
does not qualify real Metal inference. On the target machine, complete this
once after setup:

```bash
./chess-llama model status --format json
curl -fsS http://127.0.0.1:3001/api/health
./chess-llama model benchmark --profile qwen3-4b-q4-k-m --format human
```

Run the first two commands while `dev` is active in another terminal. On
Apple Silicon, model status should report provider `native-metal` and runtime
state `running`; backend health should report backend `Metal`. Open the browser,
play one legal move, and confirm that the AI replies with commentary. Linux and
WSL2 should report provider `docker-cuda` and backend `CUDA`.

## Troubleshooting setup

- **Docker permission denied on Ubuntu:** sign out and back in after adding the
  Docker group, then run `docker info` without `sudo`.
- **Docker unavailable in WSL2:** start Docker Desktop and enable integration
  for the exact Ubuntu distribution shown by `wsl --list --verbose`.
- **CUDA GPU check fails:** make `nvidia-smi` work first, then revisit the
  platform-specific Docker/NVIDIA steps.
- **Metal is absent from `llama-server --list-devices`:** confirm the machine is
  `arm64`, update the Homebrew formula, and rerun `brew reinstall llama.cpp`.
- **Intel Mac is rejected:** use an Apple Silicon Mac or the supported
  Linux/WSL2 NVIDIA path; Rosetta does not provide the supported Metal runtime.
- **A model download was interrupted:** rerun `./chess-llama model pull`; an
  incomplete or corrupt file is never activated.
- **Startup fails:** run `./chess-llama --verbose dev` and inspect
  `./chess-llama model logs`.

See [operations](operations.md) for lifecycle and data paths, and
[Compose deployment](deployment.md) for the four-container Linux/WSL2 runtime.
