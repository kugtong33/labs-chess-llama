#!/usr/bin/env bats

load test_helper

@test "root help exposes every namespace" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" --help

  [ "$status" -eq 0 ]
  assert_output_contains "local hybrid chess gateway and runtime"
  for namespace in client db dev doctor gateway logs model; do
    assert_output_contains "$namespace"
  done
  assert_output_contains "--verbose"
}

@test "unknown commands use the stable input exit code" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" unknown

  [ "$status" -eq 2 ]
  assert_stderr_contains "[ERROR] cli: Unknown command: unknown"
  [[ $stderr != *$'\033['* ]]
}

@test "global verbose mode adds debug context without changing command output" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" --verbose help model

  [ "$status" -eq 0 ]
  assert_output_contains "Usage: chess-llama model"
  assert_stderr_contains "[DEBUG] cli: dispatch command=help"
}

@test "the debug environment setting is equivalent to global verbose mode" {
  CHESS_LLAMA_LOG_LEVEL=debug run --separate-stderr "$PROJECT_ROOT/chess-llama" help model

  [ "$status" -eq 0 ]
  assert_output_contains "Usage: chess-llama model"
  assert_stderr_contains "[DEBUG] cli: dispatch command=help"
}

@test "verbose is rejected after a namespace" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" client --verbose

  [ "$status" -eq 2 ]
  assert_stderr_contains "Unknown client command: --verbose"
}

@test "debug command rendering redacts URL credentials queries and secret arguments" {
  # The command source is intentionally deferred to the nested shell.
  # shellcheck disable=SC2016
  run --separate-stderr env CHESS_LLAMA_LOG_LEVEL=debug bash -c \
    'source "$1"; chess_llama_debug_command model curl --api-key top-secret "https://user:password@example.test/model.gguf?token=secret#fragment"' \
    _ "$PROJECT_ROOT/scripts/cli/output.sh"

  [ "$status" -eq 0 ]
  assert_stderr_contains "[DEBUG] model: run"
  assert_stderr_contains "--api-key"
  assert_stderr_contains "<redacted>"
  assert_stderr_contains "https://example.test/model.gguf"
  [[ $stderr != *"top-secret"* ]]
  [[ $stderr != *"user:password"* ]]
  [[ $stderr != *"token=secret"* ]]
}

@test "debug command rendering redacts lowercase secret assignments" {
  # The command source is intentionally deferred to the nested shell.
  # shellcheck disable=SC2016
  run --separate-stderr env CHESS_LLAMA_LOG_LEVEL=debug bash -c \
    'source "$1"; chess_llama_debug_command gateway env api_token=hidden node server.js' \
    _ "$PROJECT_ROOT/scripts/cli/output.sh"

  [ "$status" -eq 0 ]
  assert_stderr_contains "api_token=<redacted>"
  [[ $stderr != *"hidden"* ]]
}

@test "debug command rendering redacts inline secret options" {
  # The command source is intentionally deferred to the nested shell.
  # shellcheck disable=SC2016
  run --separate-stderr env CHESS_LLAMA_LOG_LEVEL=debug bash -c \
    'source "$1"; chess_llama_debug_command model curl --api-key=top-secret --token=hidden' \
    _ "$PROJECT_ROOT/scripts/cli/output.sh"

  [ "$status" -eq 0 ]
  assert_stderr_contains "--api-key=<redacted>"
  assert_stderr_contains "--token=<redacted>"
  [[ $stderr != *"top-secret"* ]]
  [[ $stderr != *"hidden"* ]]
}

@test "debug command rendering sanitizes URLs inside assignments and options" {
  # The command source is intentionally deferred to the nested shell.
  # shellcheck disable=SC2016
  run --separate-stderr env CHESS_LLAMA_LOG_LEVEL=debug bash -c \
    'source "$1"; chess_llama_debug_command gateway env LLAMA_BASE_URL="https://user:password@example.test/v1?token=hidden#fragment" node --url="https://user:password@example.test/model?token=hidden#fragment"' \
    _ "$PROJECT_ROOT/scripts/cli/output.sh"

  [ "$status" -eq 0 ]
  assert_stderr_contains "LLAMA_BASE_URL=https://example.test/v1"
  assert_stderr_contains "--url=https://example.test/model"
  [[ $stderr != *"user:password"* ]]
  [[ $stderr != *"token=hidden"* ]]
  [[ $stderr != *"fragment"* ]]
}

@test "log markers use color only on an eligible stderr terminal" {
  export TERM=xterm-256color
  unset NO_COLOR

  run --keep-empty-lines --separate-stderr script --quiet --return \
    --command "bash -c 'source \"$PROJECT_ROOT/scripts/cli/output.sh\"; chess_llama_info cli ready'" /dev/null

  [ "$status" -eq 0 ]
  [[ $output == *$'\033[36m[INFO]\033[0m cli: ready'* ]]

  export NO_COLOR=1
  run --keep-empty-lines --separate-stderr script --quiet --return \
    --command "bash -c 'source \"$PROJECT_ROOT/scripts/cli/output.sh\"; chess_llama_info cli ready'" /dev/null

  [ "$status" -eq 0 ]
  [[ $output != *$'\033['* ]]
}

@test "the pnpm wrapper separator is accepted" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" -- --help

  [ "$status" -eq 0 ]
  assert_output_contains "Usage: chess-llama"
}

@test "namespaced help routes to the requested command" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" help model

  [ "$status" -eq 0 ]
  assert_output_contains "Usage: chess-llama model"
}

@test "logs help routes to the unified follower namespace" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" help logs

  [ "$status" -eq 0 ]
  assert_output_contains "Usage: chess-llama logs follow"
}

@test "missing compiled operations are prerequisite failures" {
  export CHESS_LLAMA_DATABASE_ENTRY=$TEST_ROOT/missing-database.js

  run --separate-stderr "$PROJECT_ROOT/chess-llama" db status

  [ "$status" -eq 3 ]
  assert_stderr_contains "Operations build is missing"
}
