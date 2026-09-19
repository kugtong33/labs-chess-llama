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
