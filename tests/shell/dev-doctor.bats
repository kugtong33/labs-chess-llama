#!/usr/bin/env bats
# Lifecycle assertions intentionally match literal shell variable references.
# shellcheck disable=SC2016

load test_helper

@test "doctor reports JSON checks and the prerequisite exit code" {
  make_tool pnpm <<'EOF'
printf '0.0.0\n'
EOF
  make_tool docker <<'EOF'
printf 'docker unavailable\n' >&2
exit 1
EOF

  run --separate-stderr "$PROJECT_ROOT/chess-llama" doctor --format json

  [ "$status" -eq 3 ]
  assert_output_contains '"prerequisitesOk":false'
  assert_output_contains '"name":"node","ok":true'
  assert_output_contains '"name":"pnpm","ok":false'
  assert_output_contains '"name":"docker","ok":false'
}

@test "dev stops before startup when prerequisites fail" {
  make_tool pnpm <<'EOF'
printf '0.0.0\n'
EOF
  make_tool docker <<'EOF'
exit 1
EOF

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" dev

  [ "$status" -eq 3 ]
  [ -z "$output" ]
}

@test "dev isolates children and terminates process groups in reverse order" {
  local dev_source client_prefix gateway_prefix
  dev_source=$(<"$PROJECT_ROOT/scripts/cli/dev.sh")

  [[ $dev_source == *'setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" gateway start &'* ]]
  [[ $dev_source == *'setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" client dev &'* ]]
  [[ $dev_source == *'"$CHESS_LLAMA_DEV_CLIENT_PID"'* ]]
  [[ $dev_source == *'"$CHESS_LLAMA_DEV_GATEWAY_PID"'* ]]
  client_prefix=${dev_source%%'"$CHESS_LLAMA_DEV_CLIENT_PID"'*}
  gateway_prefix=${dev_source%%'"$CHESS_LLAMA_DEV_GATEWAY_PID"'*}
  [ "${#client_prefix}" -lt "${#gateway_prefix}" ]
  [[ $dev_source == *'kill -TERM -- "-$pid"'* ]]
}
