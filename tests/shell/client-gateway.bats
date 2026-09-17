#!/usr/bin/env bats
# Bats isolates each test in a subshell.
# shellcheck disable=SC2030,SC2031

load test_helper

@test "client build delegates to Vite through pnpm" {
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_trace_tool pnpm

  run --separate-stderr "$PROJECT_ROOT/chess-llama" client build

  [ "$status" -eq 0 ]
  assert_trace_contains "pnpm --filter @chess-llama/client exec vite build"
}

@test "gateway development uses Node and the resolved database path" {
  local database=$TEST_ROOT/state/chess.sqlite
  export CHESS_LLAMA_DATABASE_FILE=$database
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_trace_tool node

  run --separate-stderr "$PROJECT_ROOT/chess-llama" gateway dev

  [ "$status" -eq 0 ]
  assert_trace_contains "node --import tsx $PROJECT_ROOT/apps/gateway/src/main.ts"
  assert_trace_contains "DATABASE_PATH=$database"
}

@test "gateway health uses curl and preserves JSON output" {
  make_tool curl <<'EOF'
printf '{"status":"ok"}\n'
EOF

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" gateway health --format json

  [ "$status" -eq 0 ]
  [ "$output" = $'{"status":"ok"}\n' ]
}
