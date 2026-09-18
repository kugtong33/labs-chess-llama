#!/usr/bin/env bats
# Bats isolates each test in a subshell.
# shellcheck disable=SC2016,SC2030,SC2031

load test_helper

@test "runtime image uses the pinned default when the manifest command is empty" {
  local runtime_entry=$TEST_ROOT/runtime.js
  printf 'placeholder\n' >"$runtime_entry"
  export CHESS_LLAMA_RUNTIME_ENTRY=$runtime_entry
  make_tool node <<'EOF'
exit 0
EOF

  run --separate-stderr bash -c \
    'source "$1/scripts/cli/core.sh"; chess_llama_runtime_image' \
    _ "$PROJECT_ROOT"

  [ "$status" -eq 0 ]
  [ "$output" = "ghcr.io/ggml-org/llama.cpp@sha256:5268283a8d6510d167364f19aee93e98180d8eb0cac4b7edb20af7e3edf40c17" ]
  assert_stderr_contains "[WARN] runtime: manifest returned an empty image; using pinned default"
  assert_stderr_contains "image=$output"
}

@test "unknown model profiles use the stable input exit code" {
  local runtime_entry=$TEST_ROOT/runtime.js
  printf 'placeholder\n' >"$runtime_entry"
  export CHESS_LLAMA_RUNTIME_ENTRY=$runtime_entry
  make_tool node <<'EOF'
printf 'Unknown model profile: missing\n' >&2
exit 1
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model pull --profile missing

  [ "$status" -eq 2 ]
  assert_stderr_contains "Unknown model profile: missing"
}

@test "model pull installs only checksum-verified weights through curl" {
  local runtime_entry=$TEST_ROOT/runtime.js
  local model_dir=$TEST_ROOT/models
  export CHESS_LLAMA_RUNTIME_ENTRY=$runtime_entry
  export CHESS_LLAMA_MODEL_DIR=$model_dir
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  export CHESS_LLAMA_TEST_MODEL_BYTES='verified model'
  CHESS_LLAMA_TEST_CHECKSUM=$(printf '%s' "$CHESS_LLAMA_TEST_MODEL_BYTES" | sha256sum | awk '{print $1}')
  export CHESS_LLAMA_TEST_CHECKSUM
  printf 'placeholder\n' >"$runtime_entry"
  make_tool node <<'EOF'
case "$2" in
  profile) printf '{}\n' ;;
  image) printf 'example.invalid/llama@sha256:%064d\n' 0 ;;
  profile-field)
    case "$4" in
      file) printf 'model.gguf\n' ;;
      sha256) printf '%s\n' "$CHESS_LLAMA_TEST_CHECKSUM" ;;
      url) printf 'https://example.invalid/model.gguf\n' ;;
    esac
    ;;
esac
EOF
  make_tool docker <<'EOF'
printf '%s\n' "$*" >>"$CHESS_LLAMA_TEST_TRACE"
EOF
  make_tool curl <<'EOF'
while (($#)); do
  if [[ $1 == --output ]]; then
    shift
    destination=$1
  fi
  shift
done
printf '%s' "$CHESS_LLAMA_TEST_MODEL_BYTES" >"$destination"
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model pull --profile test-profile

  [ "$status" -eq 0 ]
  [ "$(sha256sum -- "$model_dir/model.gguf" | awk '{print $1}')" = "$CHESS_LLAMA_TEST_CHECKSUM" ]
  assert_trace_contains "compose -f"
  assert_stderr_contains "[INFO] model: selected profile profile=test-profile source=explicit"
  assert_stderr_contains "file=model.gguf"
  assert_stderr_contains "directory=$model_dir"
  assert_stderr_contains "[INFO] model: downloading weights"
  assert_stderr_contains "[OK] model: weights installed"
}

@test "model pull reports the original download exit status" {
  local runtime_entry=$TEST_ROOT/runtime.js
  export CHESS_LLAMA_RUNTIME_ENTRY=$runtime_entry
  export CHESS_LLAMA_MODEL_DIR=$TEST_ROOT/models
  export CHESS_LLAMA_TEST_CHECKSUM
  CHESS_LLAMA_TEST_CHECKSUM=$(printf 'expected' | sha256sum | awk '{print $1}')
  printf 'placeholder\n' >"$runtime_entry"
  make_tool node <<'EOF'
case "$2" in
  profile) printf '{}\n' ;;
  image) printf 'example.invalid/llama@sha256:%064d\n' 0 ;;
  profile-field)
    case "$4" in
      file) printf 'model.gguf\n' ;;
      sha256) printf '%s\n' "$CHESS_LLAMA_TEST_CHECKSUM" ;;
      url) printf 'https://example.invalid/model.gguf\n' ;;
    esac
    ;;
esac
EOF
  make_tool docker <<'EOF'
exit 0
EOF
  make_tool curl <<'EOF'
exit 22
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model pull --profile test-profile

  [ "$status" -eq 4 ]
  assert_stderr_contains "[ERROR] model: weight download failed"
  assert_stderr_contains "exitCode=22"
}

@test "model start rejects a healthy server carrying the wrong model" {
  local runtime_entry=$TEST_ROOT/runtime.js
  local model_dir=$TEST_ROOT/models
  export CHESS_LLAMA_RUNTIME_ENTRY=$runtime_entry
  export CHESS_LLAMA_MODEL_DIR=$model_dir
  export CHESS_LLAMA_TEST_MODEL_BYTES='verified model'
  CHESS_LLAMA_TEST_CHECKSUM=$(printf '%s' "$CHESS_LLAMA_TEST_MODEL_BYTES" | sha256sum | awk '{print $1}')
  export CHESS_LLAMA_TEST_CHECKSUM
  printf 'placeholder\n' >"$runtime_entry"
  mkdir -p "$model_dir"
  printf '%s' "$CHESS_LLAMA_TEST_MODEL_BYTES" >"$model_dir/model.gguf"
  make_tool node <<'EOF'
case "$2" in
  profile) printf '{}\n' ;;
  image) printf 'example.invalid/llama@sha256:%064d\n' 0 ;;
  profile-field)
    case "$4" in
      file) printf 'model.gguf\n' ;;
      sha256) printf '%s\n' "$CHESS_LLAMA_TEST_CHECKSUM" ;;
    esac
    ;;
  *) "$TEST_NODE" "$@" ;;
esac
EOF
  make_tool docker <<'EOF'
exit 0
EOF
  make_tool curl <<'EOF'
case "${!#}" in
  */v1/models) printf '{"data":[{"id":"other.gguf"}]}\n' ;;
  *) printf '{"status":"ok"}\n' ;;
esac
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model start --profile test-profile

  [ "$status" -eq 5 ]
  assert_stderr_contains "[INFO] model: starting runtime profile=test-profile"
  assert_stderr_contains "[OK] model: runtime health check passed"
  assert_stderr_contains "[ERROR] model: loaded model does not match profile"
  assert_stderr_contains "loaded=other.gguf expected=model.gguf"
}

@test "model stop delegates to Docker Compose" {
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_tool docker <<'EOF'
printf '%s\n' "$0 $*" >>"$CHESS_LLAMA_TEST_TRACE"
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model stop

  [ "$status" -eq 0 ]
  assert_trace_contains "docker compose -f $PROJECT_ROOT/infra/compose.yaml rm -s -f llama"
  assert_stderr_contains "[INFO] model: stopping runtime container=chess-llama-model"
  assert_stderr_contains "[OK] model: runtime stopped"
}

@test "model logs use the established JSON result envelope" {
  make_tool docker <<'EOF'
printf 'llama ready\n'
printf 'compose warning\n' >&2
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model logs

  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"exitCode":0,"stdout":"llama ready","stderr":"compose warning"}'
  [ -z "$stderr" ]
}

@test "model status remains quiet by default and traces Compose when verbose" {
  make_tool docker <<'EOF'
exit 0
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model status --format json
  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"containerState":"stopped","healthy":false,"port":8080}'
  [ -z "$stderr" ]

  run --separate-stderr "$PROJECT_ROOT/chess-llama" --verbose model status --format json
  [ "$status" -eq 0 ]
  assert_stderr_contains "[DEBUG] model: run docker compose -f"
  assert_stderr_contains "ps --status running --format json llama"
}

@test "model status explains an unavailable container-state probe" {
  make_tool docker <<'EOF'
exit 19
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model status --format json

  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"containerState":"unknown","healthy":false,"port":8080}'
  assert_stderr_contains "[WARN] model: container state probe failed"
  assert_stderr_contains "exitCode=19"
}

@test "model status explains a failed health probe for a running container" {
  make_tool docker <<'EOF'
printf '{}\n'
EOF
  make_tool curl <<'EOF'
exit 28
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model status --format json

  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"containerState":"running","healthy":false,"port":8080}'
  assert_stderr_contains "[WARN] model: runtime health probe failed"
  assert_stderr_contains "endpoint=http://127.0.0.1:8080/v1/health"
  assert_stderr_contains "exitCode=28"
}

@test "model logs preserve a failing Docker Compose status" {
  make_tool docker <<'EOF'
printf 'logs failed\n' >&2
exit 17
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model logs

  [ "$status" -eq 17 ]
  assert_json_equals "$output" '{"exitCode":17,"stdout":"","stderr":"logs failed"}'
  assert_stderr_contains "[ERROR] model: container logs failed exitCode=17"
}

@test "model benchmark passes every requested profile to the Node operation" {
  local benchmark_entry=$TEST_ROOT/benchmark.js
  export CHESS_LLAMA_BENCHMARK_ENTRY=$benchmark_entry
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  printf 'placeholder\n' >"$benchmark_entry"
  make_tool node <<'EOF'
printf '%s\n' "$0 $*" >>"$CHESS_LLAMA_TEST_TRACE"
printf '%s\n' '{"qualified":true,"profiles":[],"status":"PASS"}'
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model benchmark \
    --profile small \
    --profile credible \
    --format json

  [ "$status" -eq 0 ]
  assert_trace_contains "node $benchmark_entry run small credible"
  assert_output_contains '"qualified":true'
  [ -z "$stderr" ]
}

@test "model benchmark reports the failing operation exit status" {
  local benchmark_entry=$TEST_ROOT/benchmark.js
  export CHESS_LLAMA_BENCHMARK_ENTRY=$benchmark_entry
  printf 'placeholder\n' >"$benchmark_entry"
  make_tool node <<'EOF'
exit 9
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model benchmark --format json

  [ "$status" -eq 9 ]
  assert_stderr_contains "[ERROR] model: benchmark execution failed"
  assert_stderr_contains "exitCode=9"
}
