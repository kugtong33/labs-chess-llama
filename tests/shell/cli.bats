#!/usr/bin/env bats

setup() {
  PROJECT_ROOT=$(cd "$BATS_TEST_DIRNAME/../.." && pwd -P)
  TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/chess-llama-bats.XXXXXX")
  export PROJECT_ROOT TEST_ROOT
  export CHESS_LLAMA_PROJECT_ROOT=$PROJECT_ROOT
  export HOME=$TEST_ROOT/home
  export XDG_CONFIG_HOME=$TEST_ROOT/config
  export XDG_DATA_HOME=$TEST_ROOT/data
  export XDG_CACHE_HOME=$TEST_ROOT/cache
  export XDG_RUNTIME_DIR=$TEST_ROOT/run
  mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$TEST_ROOT/bin"
}

teardown() {
  rm -rf -- "$TEST_ROOT"
}

@test "root help exposes every namespace" {
  run "$PROJECT_ROOT/chess-llama" --help

  [ "$status" -eq 0 ]
  [[ "$output" == *client* ]]
  [[ "$output" == *gateway* ]]
  [[ "$output" == *model* ]]
  [[ "$output" == *doctor* ]]
}

@test "unknown commands use the stable input exit code" {
  run "$PROJECT_ROOT/chess-llama" not-a-command

  [ "$status" -eq 2 ]
  [[ "$output" == *"Unknown command: not-a-command"* ]]
}

@test "client build delegates to Vite through pnpm" {
  cat >"$TEST_ROOT/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$TEST_ROOT/trace"
EOF
  chmod +x "$TEST_ROOT/bin/pnpm"
  export PATH=$TEST_ROOT/bin:/usr/bin:/bin

  run "$PROJECT_ROOT/chess-llama" client build

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_ROOT/trace")" = "--filter @chess-llama/client exec vite build" ]
}

@test "missing compiled operations are prerequisite failures" {
  export CHESS_LLAMA_DATABASE_ENTRY=$TEST_ROOT/missing-database.js

  run "$PROJECT_ROOT/chess-llama" db status

  [ "$status" -eq 3 ]
  [[ "$output" == *"Operations build is missing"* ]]
}
