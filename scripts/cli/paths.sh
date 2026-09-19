#!/usr/bin/env bash

chess_llama_absolute_or() {
  local candidate=${1:-}
  local fallback=$2
  if [[ $candidate == /* ]]; then
    printf '%s\n' "$candidate"
  else
    printf '%s\n' "$fallback"
  fi
}

chess_llama_resolve_paths() {
  local user_home=${CHESS_LLAMA_HOME:-${HOME:-}}
  local config_home data_home cache_home data_dir
  config_home=$(chess_llama_absolute_or "${XDG_CONFIG_HOME:-}" "$user_home/.config")
  data_home=$(chess_llama_absolute_or "${XDG_DATA_HOME:-}" "$user_home/.local/share")
  cache_home=$(chess_llama_absolute_or "${XDG_CACHE_HOME:-}" "$user_home/.cache")
  data_dir=$data_home/chess-llama

  CHESS_LLAMA_CONFIG_FILE=$(chess_llama_absolute_or "${CHESS_LLAMA_CONFIG_FILE:-}" "$config_home/chess-llama/config.json")
  CHESS_LLAMA_DATABASE_FILE=$(chess_llama_absolute_or "${CHESS_LLAMA_DATABASE_FILE:-}" "$data_dir/chess-llama.sqlite")
  CHESS_LLAMA_BACKUPS_DIR=$(chess_llama_absolute_or "${CHESS_LLAMA_BACKUPS_DIR:-}" "$data_dir/backups")
  CHESS_LLAMA_BENCHMARKS_DIR=$(chess_llama_absolute_or "${CHESS_LLAMA_BENCHMARKS_DIR:-}" "$data_dir/benchmarks")
  CHESS_LLAMA_MODEL_DIR=$(chess_llama_absolute_or "${CHESS_LLAMA_MODEL_DIR:-}" "$cache_home/chess-llama/models")
  CHESS_LLAMA_COMPOSE_FILE=$(chess_llama_absolute_or "${CHESS_LLAMA_COMPOSE_FILE:-}" "$CHESS_LLAMA_PROJECT_ROOT/compose.yaml")
  export CHESS_LLAMA_CONFIG_FILE CHESS_LLAMA_DATABASE_FILE CHESS_LLAMA_BACKUPS_DIR
  export CHESS_LLAMA_BENCHMARKS_DIR CHESS_LLAMA_MODEL_DIR CHESS_LLAMA_COMPOSE_FILE
}

chess_llama_run_in_project() {
  (
    cd -- "$CHESS_LLAMA_PROJECT_ROOT" || exit
    "$@"
  )
}
