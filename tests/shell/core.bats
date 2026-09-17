#!/usr/bin/env bats

load test_helper

@test "root help exposes every namespace" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" --help

  [ "$status" -eq 0 ]
  assert_output_contains "local hybrid chess gateway and runtime"
  for namespace in client db dev doctor gateway model; do
    assert_output_contains "$namespace"
  done
}

@test "unknown commands use the stable input exit code" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" unknown

  [ "$status" -eq 2 ]
  assert_stderr_contains "Unknown command: unknown"
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

@test "missing compiled operations are prerequisite failures" {
  export CHESS_LLAMA_DATABASE_ENTRY=$TEST_ROOT/missing-database.js

  run --separate-stderr "$PROJECT_ROOT/chess-llama" db status

  [ "$status" -eq 3 ]
  assert_stderr_contains "Operations build is missing"
}
