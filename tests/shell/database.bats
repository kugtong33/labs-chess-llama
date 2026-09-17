#!/usr/bin/env bats
# Bats isolates each test in a subshell.
# shellcheck disable=SC2030,SC2031

load test_helper

@test "database migrate reports its resolved path and completion" {
  local database_entry=$TEST_ROOT/database.js
  local database=$TEST_ROOT/state/chess.sqlite
  printf 'placeholder\n' >"$database_entry"
  export CHESS_LLAMA_DATABASE_ENTRY=$database_entry
  export CHESS_LLAMA_DATABASE_FILE=$database
  make_tool node <<'EOF'
printf '{"migrated":true}\n'
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" db migrate

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  assert_stderr_contains "[INFO] database: applying migrations database=$database"
  assert_stderr_contains "[OK] database: migrations complete database=$database"
}

@test "database backup preserves its result and reports the destination" {
  local database_entry=$TEST_ROOT/database.js
  local database=$TEST_ROOT/state/chess.sqlite
  local destination=$TEST_ROOT/backups/chess-llama-123.sqlite
  printf 'placeholder\n' >"$database_entry"
  export CHESS_LLAMA_DATABASE_ENTRY=$database_entry
  export CHESS_LLAMA_DATABASE_FILE=$database
  export CHESS_LLAMA_BACKUPS_DIR=$TEST_ROOT/backups
  export CHESS_LLAMA_TEST_BACKUP=$destination
  make_tool node <<'EOF'
if [[ $1 == --input-type=module ]]; then
  exec "$TEST_NODE" "$@"
fi
printf '{"path":"%s"}\n' "$CHESS_LLAMA_TEST_BACKUP"
EOF

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" db backup

  [ "$status" -eq 0 ]
  [ "$output" = "{\"path\":\"$destination\"}"$'\n' ]
  assert_stderr_contains "[INFO] database: creating backup database=$database backups=$TEST_ROOT/backups"
  assert_stderr_contains "[OK] database: backup complete destination=$destination"
}

@test "database status remains quiet unless verbose mode is enabled" {
  local database_entry=$TEST_ROOT/database.js
  printf 'placeholder\n' >"$database_entry"
  export CHESS_LLAMA_DATABASE_ENTRY=$database_entry
  make_tool node <<'EOF'
printf '{"current":1,"expected":1,"pending":false}\n'
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" db status --format json
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]

  run --separate-stderr "$PROJECT_ROOT/chess-llama" --verbose db status --format json
  [ "$status" -eq 0 ]
  assert_stderr_contains "[DEBUG] database: checking migration status"
}
