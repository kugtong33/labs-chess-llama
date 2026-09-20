#!/usr/bin/env bash

chess_llama_host_runtime_entry() {
  printf '%s\n' "${CHESS_LLAMA_HOST_RUNTIME_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/host-runtime.js}"
}

chess_llama_host_runtime() {
  local entry
  entry=$(chess_llama_host_runtime_entry)
  chess_llama_require_operations_entry "$entry" host || return
  chess_llama_debug_command host node "$entry" "$@"
  node "$entry" "$@"
}

chess_llama_runtime_provider() {
  chess_llama_host_runtime provider
}

chess_llama_port_in_use() {
  local result
  result=$(chess_llama_port_state "$1") || return
  [[ $result == true ]]
}

chess_llama_port_state() {
  chess_llama_host_runtime port-in-use "$1"
}

chess_llama_hash_file() {
  chess_llama_host_runtime hash "$1"
}

chess_llama_install_artifact() {
  chess_llama_host_runtime install-artifact "$1" "$2" "$3"
}

chess_llama_supervise() {
  chess_llama_host_runtime supervise "$@"
}
