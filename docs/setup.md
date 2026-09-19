# Setup

This guide prepares a new machine for Chess Llama and ends with a successful
`./chess-llama dev` start. Complete one platform section, then follow the
[project setup](#project-setup-linux-and-wsl2).

## Platform support

| Platform | Source development | `./chess-llama dev` | Docker Compose deployment |
| --- | --- | --- | --- |
| Ubuntu 24.04 LTS with a supported NVIDIA GPU | Supported | Supported | Supported |
| Windows 10/11 with Ubuntu 24.04 on WSL2 and a supported NVIDIA GPU | Supported inside WSL2 | Supported inside WSL2 | Supported through Docker Desktop |
| macOS | Build and static checks only | Not supported | Not supported |

The complete runtime is CUDA-only. It requires an NVIDIA GPU that is visible to
Linux containers. Docker Desktop exposes GPUs only on Windows with its WSL2
backend, so installing Docker Desktop on macOS does not make the llama service
available. See [Docker Desktop GPU support](https://docs.docker.com/desktop/features/gpu/).

You also need network access for the initial dependency, container-image, and
model downloads, plus enough free disk space for those artifacts.

## Ubuntu 24.04 LTS

These commands are the maintained native Linux path. Other distributions may
work, but use their official Docker, NVIDIA driver, and NVIDIA Container Toolkit
instructions rather than translating these `apt` commands.

### 1. Install host tools and the NVIDIA driver

```bash
sudo apt update
sudo apt install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  build-essential \
  python3 \
  util-linux \
  iproute2 \
  coreutils \
  ubuntu-drivers-common
sudo ubuntu-drivers install
sudo reboot
```

After the reboot, confirm that the host driver can see the GPU:

```bash
nvidia-smi
```

If Secure Boot is enabled, complete any Machine Owner Key enrollment requested
during the reboot. Do not continue until `nvidia-smi` succeeds. Ubuntu documents
the `ubuntu-drivers` flow in its
[NVIDIA driver guide](https://help.ubuntu.com/community/NvidiaDriversInstallation).

### 2. Install Docker Engine and Compose

Remove conflicting distro packages if they are installed:

```bash
sudo apt remove -y $(
  dpkg --get-selections \
    docker.io \
    docker-compose \
    docker-compose-v2 \
    docker-doc \
    docker-buildx \
    podman-docker \
    containerd \
    runc \
    | cut -f1
)
```

It is safe if `apt` reports that none of them are installed. Add Docker's
official repository and install the engine with its Compose plugin:

```bash
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
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
```

These commands follow Docker's
[Ubuntu installation guide](https://docs.docker.com/engine/install/ubuntu/).
Allow your user to access the Docker daemon without `sudo`, then sign out and
back in so the new group is applied:

```bash
sudo usermod -aG docker "$USER"
```

Membership in the `docker` group grants root-level privileges. Review Docker's
[Linux post-install guidance](https://docs.docker.com/engine/install/linux-postinstall/)
before using this on a shared system. In a new login session, verify both
commands:

```bash
docker info
docker compose version
```

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
```

This follows NVIDIA's
[Container Toolkit installation guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).
Recheck Docker after the restart:

```bash
docker info
```

Continue with [Node.js 24](#install-nodejs-24) and then
[project setup](#project-setup-linux-and-wsl2).

## Windows with WSL2

The application runs inside Ubuntu, not from PowerShell or Command Prompt.
Windows owns the NVIDIA driver and Docker Desktop; Ubuntu owns the source tree,
Node.js, pnpm, and the project commands.

### 1. Install or update WSL2

Open **PowerShell as Administrator** and run:

```powershell
wsl --list --online
wsl --install -d Ubuntu-24.04
wsl --update
wsl --set-default-version 2
wsl --list --verbose
```

Restart Windows if prompted, open Ubuntu, and create the requested Linux user.
The Ubuntu row printed by `wsl --list --verbose` must show version `2`. See
[Microsoft's WSL installation guide](https://learn.microsoft.com/windows/wsl/install).

### 2. Install the Windows NVIDIA driver

Install a current NVIDIA Windows driver with WSL2 CUDA support, then restart
Windows. NVIDIA's [CUDA on WSL guide](https://docs.nvidia.com/cuda/wsl-user-guide/)
is authoritative for supported drivers.

Do **not** install an NVIDIA Linux display driver or CUDA driver package inside
Ubuntu. WSL2 exposes the Windows driver to Linux, and a Linux driver can replace
or break that integration.

In the Ubuntu shell, verify:

```bash
nvidia-smi
```

### 3. Install and enable Docker Desktop

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Open Docker Desktop and select **Settings → General → Use the WSL 2 based engine**.
3. Select **Settings → Resources → WSL Integration**, enable Ubuntu 24.04, and apply the change.
4. Keep Docker Desktop running while using Chess Llama.

Do not install Docker Engine or NVIDIA Container Toolkit inside the Ubuntu
distribution; Docker Desktop supplies both Docker access and GPU integration.
Docker documents this arrangement in its
[WSL2 backend guide](https://docs.docker.com/desktop/features/wsl/).

Verify from the Ubuntu shell, not PowerShell:

```bash
docker info
docker compose version
```

### 4. Install Ubuntu command-line tools

In the Ubuntu shell, run:

```bash
sudo apt update
sudo apt install -y \
  ca-certificates \
  curl \
  git \
  build-essential \
  python3 \
  util-linux \
  iproute2 \
  coreutils
```

Keep the checkout in the WSL filesystem for reliable permissions and faster
file access. For example, use `~/src/labs-chess-llama`, not a path below
`/mnt/c`.

Continue with [Node.js 24](#install-nodejs-24) and then
[project setup](#project-setup-linux-and-wsl2), running every command in the
Ubuntu shell.

## Install Node.js 24

Use the same Node installation on Ubuntu and WSL2. The nvm installer works on
both and keeps the project version separate from system packages:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
node --version
```

The final command must print a `v24.x.x` version. Future terminals load nvm from
the shell profile updated by its installer. The command is pinned to the
[nvm project's published installer](https://github.com/nvm-sh/nvm#installing-and-updating).

## Project setup: Linux and WSL2

Run this sequence in a Bash shell after completing the Ubuntu or WSL2
prerequisites:

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

If the repository is already cloned, start at its root and skip the clone
commands. The first model pull builds the pinned llama image, downloads the
GGUF, and verifies its SHA-256, so it can take several minutes.

After `model pull`, `doctor` must report:

```text
Status: READY (all required checks passed)
```

Model and backend health can still appear as runtime warnings before `dev`
starts them. `dev` then starts or reuses the llama container, migrates SQLite,
and starts the backend and Vite web server. Open <http://127.0.0.1:5173>.
Press Ctrl-C once to stop resources started by that invocation; model weights
and application data remain on disk.

Run the production dependency audit separately when contributing or reviewing
dependency changes; it is not a startup prerequisite:

```bash
pnpm audit --prod --audit-level high
```

## macOS source development

macOS cannot run the CUDA llama container, so `./chess-llama dev`, `model`
commands, and the complete Compose deployment are unsupported. This section is
only for editing the source and running platform-neutral static checks.

Install Apple's command-line tools and Homebrew, if needed:

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
brew install bash coreutils git
```

Also follow Homebrew's printed instruction to make that shell configuration
permanent. Then install Node.js 24 using the
[nvm commands above](#install-nodejs-24), clone the repository, and run:

```bash
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
```

Docker Desktop is optional for inspecting Compose configuration or building
non-GPU images, but it does not make the full application runtime supported on
macOS. Use Ubuntu 24.04 with NVIDIA hardware, or Windows with WSL2 and NVIDIA
hardware, to run the complete game.

## What `doctor` checks

`./chess-llama doctor --format human` is the readiness contract used by
`./chess-llama dev`. It checks:

- Bash 5, Node.js 24, and the exact pnpm version declared in `package.json`.
- Docker daemon access and the Docker Compose plugin.
- `curl`, `flock`, `script`, `setsid`, `sha256sum`, and `ss`.
- GPU access from the exact pinned llama container image.
- Writable config, database, backup, benchmark, and model directories.
- The selected model file and its checksum.

It also reports ports, migration state, and running service health without
making those pre-start runtime observations block readiness.

## Troubleshooting setup

- **Docker permission denied on Ubuntu:** sign out and back in after adding the
  user to the `docker` group, then rerun `docker info` without `sudo`.
- **Docker unavailable inside WSL2:** start Docker Desktop and enable WSL
  integration for the exact Ubuntu distribution shown by `wsl --list --verbose`.
- **GPU check fails on Ubuntu:** make `nvidia-smi` work on the host first, then
  rerun the Container Toolkit configuration and restart Docker.
- **GPU check fails on WSL2:** update the Windows NVIDIA driver and WSL kernel;
  do not install a Linux NVIDIA driver in Ubuntu.
- **A model download was interrupted:** rerun `./chess-llama model pull`; a
  partial or corrupt file is never activated as the current model.
- **A required check remains red:** follow the numbered remedy printed by
  `doctor`, then rerun it before starting `dev`.
- **Startup fails after readiness passed:** run `./chess-llama --verbose dev`
  and inspect `./chess-llama model logs`.

For service lifecycle and data paths, see [operations](operations.md). For the
four-container deployment, see [Compose deployment](deployment.md).
