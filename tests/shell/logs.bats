#!/usr/bin/env bats
# Bats runs each test in an isolated subshell; exports do not leak between tests.
# shellcheck disable=SC2030,SC2031

load test_helper

trace_stream_entry() {
  local entry=$TEST_ROOT/trace-stream.js
  printf 'placeholder\n' >"$entry"
  export CHESS_LLAMA_TRACE_STREAM_ENTRY=$entry
}

successful_follower_tools() {
  make_tool curl <<'EOF'
printf '%s\n' "curl $*" >>"$CHESS_LLAMA_TEST_TRACE"
printf ': connected\n\n'
EOF
  make_tool node <<'EOF'
printf '%s\n' "node $*" >>"$CHESS_LLAMA_TEST_TRACE"
cat >/dev/null
EOF
}

@test "logs follow defaults to all layers and human rendering" {
  trace_stream_entry
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  successful_follower_tools

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow

  [ "$status" -eq 0 ]
  assert_trace_contains "curl --fail --silent --show-error --no-buffer http://127.0.0.1:3001/api/demo/events"
  assert_trace_contains "node $CHESS_LLAMA_TRACE_STREAM_ENTRY --format human"
  assert_stderr_contains "[INFO] logs: following decision traces"
  assert_stderr_contains "layer=all"
}

@test "logs follow filters every concrete layer at the gateway URL" {
  trace_stream_entry
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  successful_follower_tools

  local layer
  for layer in client gateway stockfish llama storage; do
    run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow --layer "$layer"

    [ "$status" -eq 0 ]
    assert_trace_contains "http://127.0.0.1:3001/api/demo/events?layer=$layer"
  done
}

@test "logs follow combines layer game and JSON format filters" {
  local game=11111111-1111-4111-8111-111111111111
  trace_stream_entry
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  successful_follower_tools

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow --layer llama --game "$game" --format json

  [ "$status" -eq 0 ]
  assert_trace_contains "http://127.0.0.1:3001/api/demo/events?layer=llama&gameId=$game"
  assert_trace_contains "node $CHESS_LLAMA_TRACE_STREAM_ENTRY --format json"
}

@test "logs follow validates layer UUID and format input" {
  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow --layer invalid
  [ "$status" -eq 2 ]
  assert_stderr_contains "Unsupported trace layer: invalid"

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow --game invalid
  [ "$status" -eq 2 ]
  assert_stderr_contains "Option --game requires a UUID"

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow --format text
  [ "$status" -eq 2 ]
  assert_stderr_contains "Unsupported output format: text"
}

@test "logs follow requires the compiled trace formatter" {
  export CHESS_LLAMA_TRACE_STREAM_ENTRY=$TEST_ROOT/missing-trace-stream.js

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow

  [ "$status" -eq 3 ]
  assert_stderr_contains "Operations build is missing"
}

@test "logs follow maps a gateway connection failure to health exit code" {
  trace_stream_entry
  make_tool curl <<'EOF'
exit 22
EOF
  make_tool node <<'EOF'
cat >/dev/null
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow

  [ "$status" -eq 5 ]
  assert_stderr_contains "[ERROR] logs: trace stream connection failed"
  assert_stderr_contains "exitCode=22"
}

@test "logs follow preserves a formatter failure status" {
  trace_stream_entry
  make_tool curl <<'EOF'
printf ': connected\n\n'
EOF
  make_tool node <<'EOF'
cat >/dev/null
exit 9
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" logs follow

  [ "$status" -eq 9 ]
  assert_stderr_contains "[ERROR] logs: trace formatter failed"
  assert_stderr_contains "exitCode=9"
}

@test "logs follow exits cleanly when interrupted" {
  trace_stream_entry
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/trace
  make_tool curl <<'EOF'
trap 'printf interrupted >"$CHESS_LLAMA_TEST_TRACE"; exit 130' INT TERM
printf ': connected\n\n'
for ((tick=0; tick<6; tick++)); do sleep 1; done
EOF
  make_tool node <<'EOF'
cat >/dev/null
EOF

  run --separate-stderr timeout --foreground --kill-after=3 --preserve-status --signal=INT 1 "$PROJECT_ROOT/chess-llama" logs follow

  [ "$status" -eq 130 ]
  [ "$(cat "$CHESS_LLAMA_TEST_TRACE")" = interrupted ]
}
