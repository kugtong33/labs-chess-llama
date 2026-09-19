#!/usr/bin/env bash

chess_llama_docker_model_prepare() {
  chess_llama_info model 'building llama service image' image "$CHESS_LLAMA_IMAGE" compose "$CHESS_LLAMA_COMPOSE_FILE"
  chess_llama_debug_command model docker compose -f "$CHESS_LLAMA_COMPOSE_FILE" build llama
  chess_llama_compose build llama || {
    local status=$?
    chess_llama_error model 'llama service image build failed' image "$CHESS_LLAMA_IMAGE" exitCode "$status"
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  }
  chess_llama_ok model 'llama service image available' image "$CHESS_LLAMA_IMAGE"
}

chess_llama_docker_model_start() {
  local profile=$1 destination=$2
  chess_llama_info model 'recreating container' container "$CHESS_LLAMA_CONTAINER" portBinding "$CHESS_LLAMA_PORT_BINDING"
  docker rm --force "$CHESS_LLAMA_CONTAINER" >/dev/null 2>&1 || true
  chess_llama_debug_command model docker compose -f "$CHESS_LLAMA_COMPOSE_FILE" run --detach --no-deps \
    --name "$CHESS_LLAMA_CONTAINER" --publish "$CHESS_LLAMA_PORT_BINDING" \
    --volume "$destination:/models/current.gguf:ro" --env "LLAMA_PROFILE_ID=$profile" llama
  chess_llama_compose run --detach --no-deps --name "$CHESS_LLAMA_CONTAINER" \
    --publish "$CHESS_LLAMA_PORT_BINDING" --volume "$destination:/models/current.gguf:ro" \
    --env "LLAMA_PROFILE_ID=$profile" llama || {
    local status=$?
    chess_llama_error model 'container start failed' container "$CHESS_LLAMA_CONTAINER" exitCode "$status"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  }
}

chess_llama_docker_model_stop() {
  local container=chess-llama-model
  chess_llama_info model 'stopping runtime' container "$container" compose "$CHESS_LLAMA_COMPOSE_FILE"
  chess_llama_debug_command model docker compose -f "$CHESS_LLAMA_COMPOSE_FILE" rm -s -f llama
  chess_llama_compose rm -s -f llama || {
    local status=$?
    chess_llama_error model 'runtime stop failed' container "$container" exitCode "$status"
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  }
  chess_llama_ok model 'runtime stopped' container "$container"
}

chess_llama_docker_model_status() {
  local ps_output status
  chess_llama_debug_command model docker compose -f "$CHESS_LLAMA_COMPOSE_FILE" ps --status running --format json llama
  if ps_output=$(chess_llama_compose ps --status running --format json llama 2>/dev/null); then
    if [[ -n $ps_output ]]; then
      printf 'running\n'
    else
      printf 'stopped\n'
    fi
  else
    status=$?
    chess_llama_warn model 'container state probe failed' compose "$CHESS_LLAMA_COMPOSE_FILE" exitCode "$status"
    printf 'unknown\n'
  fi
}

chess_llama_docker_model_logs() {
  local temporary stdout_file stderr_file status output
  temporary=$(mktemp -d "${TMPDIR:-/tmp}/chess-llama-logs.XXXXXX") || return "$CHESS_LLAMA_EXIT_UNEXPECTED"
  stdout_file=$temporary/stdout
  stderr_file=$temporary/stderr
  chess_llama_debug_command model docker compose -f "$CHESS_LLAMA_COMPOSE_FILE" logs llama
  if chess_llama_compose logs llama >"$stdout_file" 2>"$stderr_file"; then
    status=0
  else
    status=$?
  fi
  output=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const stripFinalNewline = (value) => value.replace(/\r?\n$/, "");
    process.stdout.write(JSON.stringify({
      exitCode: Number(process.argv[3]),
      stdout: stripFinalNewline(readFileSync(process.argv[1], "utf8")),
      stderr: stripFinalNewline(readFileSync(process.argv[2], "utf8")),
    }));
  ' "$stdout_file" "$stderr_file" "$status") || {
    rm -rf -- "$temporary"
    return "$CHESS_LLAMA_EXIT_UNEXPECTED"
  }
  rm -rf -- "$temporary"
  printf '%s\n' "$output"
  if ((status != 0)); then
    chess_llama_error model 'container logs failed' exitCode "$status"
  fi
  return "$status"
}
