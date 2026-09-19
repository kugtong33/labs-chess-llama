#!/usr/bin/env bats
# shellcheck disable=SC2016

load test_helper

setup() {
  chess_llama_test_setup
  setup_native_model_fixture
}

setup_native_model_fixture() {
  export CHESS_LLAMA_RUNTIME_ENTRY=$TEST_ROOT/runtime.js
  export CHESS_LLAMA_HOST_RUNTIME_ENTRY=$TEST_ROOT/host-runtime.js
  export CHESS_LLAMA_NATIVE_RUNTIME_ENTRY=$TEST_ROOT/native-runtime.js
  export CHESS_LLAMA_DATABASE_ENTRY=$TEST_ROOT/missing-database.js
  export CHESS_LLAMA_MODEL_DIR=$TEST_ROOT/models
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  export CHESS_LLAMA_TEST_NATIVE_STATUS='{"runtimeState":"stopped","owned":false}'
  export CHESS_LLAMA_TEST_CHECKSUM
  CHESS_LLAMA_TEST_CHECKSUM=$(printf 'verified model' | sha256sum | awk '{print $1}')
  mkdir -p "$CHESS_LLAMA_MODEL_DIR"
  printf '%s' 'verified model' >"$CHESS_LLAMA_MODEL_DIR/model.gguf"
  printf 'placeholder\n' >"$CHESS_LLAMA_RUNTIME_ENTRY"
  printf 'placeholder\n' >"$CHESS_LLAMA_HOST_RUNTIME_ENTRY"
  printf 'placeholder\n' >"$CHESS_LLAMA_NATIVE_RUNTIME_ENTRY"

  make_tool node <<'EOF'
if [[ $1 == "$CHESS_LLAMA_HOST_RUNTIME_ENTRY" ]]; then
  case "$2" in
    provider) printf 'native-metal\n' ;;
    hash) printf '%s\n' "$CHESS_LLAMA_TEST_CHECKSUM" ;;
    install-artifact)
      printf '%s\n' "$*" >>"$CHESS_LLAMA_TEST_TRACE"
      printf '{"status":"reused"}\n'
      ;;
  esac
  exit 0
fi
if [[ $1 == "$CHESS_LLAMA_NATIVE_RUNTIME_ENTRY" ]]; then
  printf '%s\n' "$*" >>"$CHESS_LLAMA_TEST_TRACE"
  case "$2" in
    start) printf '{"pid":4312}\n' ;;
    status) printf '%s\n' "$CHESS_LLAMA_TEST_NATIVE_STATUS" ;;
    stop) printf '{"runtimeState":"stopped","stopped":true}\n' ;;
    logs) printf '{"exitCode":0,"stdout":"Metal ready","stderr":""}\n' ;;
  esac
  exit 0
fi
if [[ $1 == "$CHESS_LLAMA_RUNTIME_ENTRY" ]]; then
  case "$2" in
    default-profile) printf 'test-profile\n' ;;
    profile) printf '{}\n' ;;
    profile-id-for-file)
      [[ $3 == model.gguf ]] && printf 'test-profile\n'
      ;;
    profile-field)
      case "$4" in
        file) printf 'model.gguf\n' ;;
        sha256) printf '%s\n' "$CHESS_LLAMA_TEST_CHECKSUM" ;;
        url) printf 'https://example.invalid/model.gguf\n' ;;
        contextSize) printf '4096\n' ;;
      esac
      ;;
  esac
  exit 0
fi
"$TEST_NODE" "$@"
EOF
  make_tool curl <<'EOF'
case "${!#}" in
  */v1/models) printf '{"data":[{"id":"test-profile"}]}\n' ;;
  *) printf '{"status":"ok"}\n' ;;
esac
EOF
  make_tool llama-server <<'EOF'
exit 0
EOF
}

@test "native model pull installs weights without invoking Docker" {
  make_tool docker <<'EOF'
printf 'Docker must not run on native Metal\n' >&2
exit 99
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model pull --profile test-profile

  [ "$status" -eq 0 ]
  assert_trace_contains "$CHESS_LLAMA_HOST_RUNTIME_ENTRY install-artifact $CHESS_LLAMA_MODEL_DIR/model.gguf"
  [[ ${stderr:-} != *Docker* ]]
}

@test "native model start delegates the Metal configuration and verifies model identity" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" model start --profile test-profile

  [ "$status" -eq 0 ]
  assert_trace_contains "$CHESS_LLAMA_NATIVE_RUNTIME_ENTRY start $XDG_STATE_HOME/chess-llama"
  assert_trace_contains "llama-server $CHESS_LLAMA_MODEL_DIR/model.gguf model.gguf test-profile 8080 4096"
  assert_stderr_contains '[OK] model: runtime ready profile=test-profile model=test-profile'
}

@test "native model status distinguishes an owned runtime from a healthy external server" {
  export CHESS_LLAMA_TEST_NATIVE_STATUS='{"runtimeState":"stopped","owned":false}'

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model status --format json

  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"provider":"native-metal","runtimeState":"external","healthy":true,"modelId":"test-profile","profileId":"test-profile","port":8080}'

  export CHESS_LLAMA_TEST_NATIVE_STATUS='{"runtimeState":"running","owned":true,"state":{"profileId":"test-profile"}}'
  run --separate-stderr "$PROJECT_ROOT/chess-llama" model status --format json

  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"provider":"native-metal","runtimeState":"running","healthy":true,"modelId":"test-profile","profileId":"test-profile","port":8080}'
}

@test "native model stop and logs use the native lifecycle rather than Compose" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" model logs
  [ "$status" -eq 0 ]
  assert_json_equals "$output" '{"exitCode":0,"stdout":"Metal ready","stderr":""}'

  run --separate-stderr "$PROJECT_ROOT/chess-llama" model stop
  [ "$status" -eq 0 ]
  assert_trace_contains "$CHESS_LLAMA_NATIVE_RUNTIME_ENTRY stop $XDG_STATE_HOME/chess-llama"
  assert_stderr_contains '[OK] model: runtime stopped provider=native-metal'
}
