#!/usr/bin/env bash

chess_llama_native_runtime_entry() {
  printf '%s\n' "${CHESS_LLAMA_NATIVE_RUNTIME_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/native-runtime.js}"
}

chess_llama_native_runtime() {
  local entry
  entry=$(chess_llama_native_runtime_entry)
  chess_llama_require_operations_entry "$entry" model || return
  chess_llama_debug_command model node "$entry" "$@"
  node "$entry" "$@"
}

chess_llama_native_model_start() {
  local profile=$1 destination=$2
  local executable
  executable=$(command -v llama-server) || {
    chess_llama_error model 'llama-server is not installed' remedy 'brew install llama.cpp'
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  }
  chess_llama_info model 'starting native Metal runtime' executable "$executable" state "$CHESS_LLAMA_STATE_DIR"
  if chess_llama_native_runtime start "$CHESS_LLAMA_STATE_DIR" "$executable" \
    "$destination" "$CHESS_LLAMA_MODEL_FILE" "$profile" "$CHESS_LLAMA_MODEL_PORT" \
    "$CHESS_LLAMA_CONTEXT_SIZE" >/dev/null; then
    :
  else
    local status=$?
    chess_llama_error model 'native runtime start failed' provider native-metal exitCode "$status"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
}

chess_llama_native_model_stop() {
  chess_llama_info model 'stopping runtime' provider native-metal state "$CHESS_LLAMA_STATE_DIR"
  if chess_llama_native_runtime stop "$CHESS_LLAMA_STATE_DIR" >/dev/null; then
    :
  else
    local status=$?
    chess_llama_error model 'runtime stop failed' provider native-metal exitCode "$status"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  chess_llama_ok model 'runtime stopped' provider native-metal
}

chess_llama_native_model_status() {
  chess_llama_native_runtime status "$CHESS_LLAMA_STATE_DIR"
}

chess_llama_native_model_logs() {
  chess_llama_native_runtime logs "$CHESS_LLAMA_STATE_DIR"
}
