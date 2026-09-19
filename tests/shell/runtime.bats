#!/usr/bin/env bats

load test_helper

@test "built runtime CLI exposes manifest values" {
  local runtime_entry=$PROJECT_ROOT/packages/operations/dist/runtime.js
  local manifest=$PROJECT_ROOT/config/runtime-manifest.json

  [ -f "$runtime_entry" ]

  run env CHESS_LLAMA_RUNTIME_MANIFEST="$manifest" "$TEST_NODE" "$runtime_entry" image
  [ "$status" -eq 0 ]
  [ "$output" = "ghcr.io/ggml-org/llama.cpp@sha256:5268283a8d6510d167364f19aee93e98180d8eb0cac4b7edb20af7e3edf40c17" ]

  run env CHESS_LLAMA_RUNTIME_MANIFEST="$manifest" "$TEST_NODE" "$runtime_entry" default-profile
  [ "$status" -eq 0 ]
  [ "$output" = "qwen3-4b-q4-k-m" ]

  run env CHESS_LLAMA_RUNTIME_MANIFEST="$manifest" "$TEST_NODE" "$runtime_entry" \
    profile-field qwen3-4b-q4-k-m file
  [ "$status" -eq 0 ]
  [ "$output" = "Qwen3-4B-Q4_K_M.gguf" ]
}

@test "host helpers expose the detected provider and portable operations" {
  local host_entry=$TEST_ROOT/host-runtime.js
  printf 'placeholder\n' >"$host_entry"
  export CHESS_LLAMA_HOST_RUNTIME_ENTRY=$host_entry
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_tool node <<'EOF'
printf '%s\n' "$*" >>"$CHESS_LLAMA_TEST_TRACE"
case "$2" in
  provider) printf 'native-metal\n' ;;
  port-in-use) printf 'true\n' ;;
  supervise) exit 17 ;;
esac
EOF

  run bash -c 'source "$1/scripts/cli/core.sh"; chess_llama_runtime_provider' _ "$PROJECT_ROOT"
  [ "$status" -eq 0 ]
  [ "$output" = native-metal ]

  run bash -c 'source "$1/scripts/cli/core.sh"; chess_llama_port_in_use 5173' _ "$PROJECT_ROOT"
  [ "$status" -eq 0 ]

  run bash -c 'source "$1/scripts/cli/core.sh"; chess_llama_supervise command argument' _ "$PROJECT_ROOT"
  [ "$status" -eq 17 ]
  assert_trace_contains "$host_entry provider"
  assert_trace_contains "$host_entry port-in-use 5173"
  assert_trace_contains "$host_entry supervise command argument"
}
