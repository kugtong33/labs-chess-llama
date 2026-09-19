#!/usr/bin/env bats
# Bats isolates each test in a subshell.
# shellcheck disable=SC2030,SC2031

load test_helper

@test "web build delegates to Vite through pnpm" {
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_trace_tool pnpm

  run --separate-stderr "$PROJECT_ROOT/chess-llama" web build

  [ "$status" -eq 0 ]
  assert_trace_contains "pnpm --filter @chess-llama/web exec vite build"
  assert_stderr_contains "[INFO] web: building production web application"
  assert_stderr_contains "project=$PROJECT_ROOT"
  assert_stderr_contains "[OK] web: build complete"
}

@test "backend development uses Node and the resolved database path" {
  local database=$TEST_ROOT/state/chess.sqlite
  export CHESS_LLAMA_DATABASE_FILE=$database
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_trace_tool node

  run --separate-stderr "$PROJECT_ROOT/chess-llama" backend dev

  [ "$status" -eq 0 ]
  assert_trace_contains "node --import tsx $PROJECT_ROOT/backend/src/main.ts"
  assert_trace_contains "DATABASE_PATH=$database"
  assert_stderr_contains "[INFO] backend: starting development server"
  assert_stderr_contains "database=$database"
  assert_stderr_contains "llamaUrl=http://127.0.0.1:8080"
}

@test "backend health uses curl and preserves JSON output" {
  make_tool curl <<'EOF'
printf '{"status":"ok"}\n'
EOF

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" backend health --format json

  [ "$status" -eq 0 ]
  [ "$output" = $'{"status":"ok"}\n' ]
  [ -z "$stderr" ]
}

@test "verbose backend health reports the endpoint without contaminating JSON" {
  make_tool curl <<'EOF'
printf '{"status":"ok"}\n'
EOF

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" --verbose backend health --format json

  [ "$status" -eq 0 ]
  [ "$output" = $'{"status":"ok"}\n' ]
  assert_stderr_contains "[DEBUG] backend: checking health endpoint=http://127.0.0.1:3001/api/health"
}
