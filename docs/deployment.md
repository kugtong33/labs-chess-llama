# Compose Deployment

This deployment is local-only: its client, gateway, and llama.cpp ports bind to `127.0.0.1`. Run these commands from the repository root. The committed root `.env` selects `docker.compose.yaml`, the project name, service ports, and direct digest-pinned public images; no additional Compose flags are needed.

## Requirements

- Native Linux, or WSL2 with Docker Desktop's WSL integration enabled.
- A working NVIDIA driver (`nvidia-smi` succeeds on the host) and an NVIDIA GPU suitable for the selected model.
- Docker Engine with Docker Compose and NVIDIA Container Toolkit on native Linux. Configure the NVIDIA runtime and restart Docker after installation.
- On WSL2, use a current Windows NVIDIA driver with CUDA-on-WSL support, run `wsl --update`, enable Docker Desktop WSL integration for the distro, and restart WSL/Docker Desktop after driver or toolkit changes.

## Start and inspect

Start the complete deployment with one command:

```bash
docker compose up -d
```

On the first start, Docker pulls the digest-pinned Node, Nginx, and llama.cpp images. `model-bootstrap` downloads and checksum-verifies the selected GGUF into the model volume, while `workspace-bootstrap` installs the root `packageManager` version of pnpm and builds a release in the workspace volume. Those initial jobs can take several minutes. A bootstrap service shown as `exited (0)` after completion is expected; the runtime services must become healthy.

```bash
docker compose ps
curl -fsS http://127.0.0.1:5173/
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:8080/health
```

Open <http://127.0.0.1:5173>. The direct health endpoints are `http://127.0.0.1:3001/api/health` (gateway) and `http://127.0.0.1:8080/health` (llama.cpp).

Use each service's logs to diagnose startup or runtime failures:

```bash
docker compose logs --tail=200 model-bootstrap
docker compose logs --tail=200 workspace-bootstrap
docker compose logs --tail=200 llama
docker compose logs --tail=200 gateway
docker compose logs --tail=200 client
```

Add `-f` to follow any of these streams. `docker compose ps` and these logs are also the first checks after an interrupted first start.

## Native mode is separate

Do not run `./chess-llama dev` (or native client, gateway, or model commands) while this Compose deployment is running: both modes use host ports `5173`, `3001`, and `8080`. Stop one mode before starting the other; changing the public bind is not supported.

Native CLI data uses its documented XDG data and cache paths. Compose instead owns Docker named volumes for SQLite, model weights, the built workspace, and the pnpm store. The two modes do not share games, settings, or downloaded weights.

## Restart, update, and persistence

For an ordinary restart or after updating the checkout, stop containers and start them again:

```bash
docker compose down
docker compose up -d
```

`docker compose down` removes the project containers and network but preserves the named `database`, `models`, `workspace`, and `pnpm` volumes (normally named with the `chess-llama_` project prefix). Games and settings remain in the database volume, while verified weights and successful workspace releases remain available for reuse. Inspect them without changing data with:

```bash
docker volume ls --filter label=com.docker.compose.project=chess-llama
```

Only use the following destructive command when intentionally discarding all Compose-managed games, settings, models, workspace releases, and pnpm cache:

```bash
docker compose down -v
```

## Bootstrap recovery

If either bootstrap service fails, do not delete volumes as a first response. Inspect the failure and resolved configuration:

```bash
docker compose ps --all
docker compose logs --tail=200 model-bootstrap
docker compose logs --tail=200 workspace-bootstrap
docker compose config --quiet
```

Correct the reported host, GPU, network, source, or configuration issue, then retry with the non-destructive lifecycle:

```bash
docker compose down
docker compose up -d
```

Model downloads are checksum-verified before activation, and application releases activate only after a successful frozen install and build. Therefore a failed bootstrap leaves a valid previous model or release intact when one exists.

## Real-GPU acceptance smoke

After all runtime services are healthy, open the client, create a game, make a legal human move (for example `e2` to `e4`), and wait until the AI response is applied. Record the game or settings state, then run the non-destructive restart commands above and confirm that state is still present. Finish with `docker compose down` if containers should be stopped; do not use `down -v` for normal acceptance.
