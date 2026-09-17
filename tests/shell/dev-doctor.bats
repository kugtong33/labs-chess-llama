#!/usr/bin/env bats
# Lifecycle assertions intentionally match literal shell variable references.
# shellcheck disable=SC2016

load test_helper

install_doctor_status_fakes() {
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/doctor-trace
  make_tool pnpm <<'EOF'
printf '11.5.1\n'
EOF
  make_tool docker <<'EOF'
printf '%s\n' "$*" >>"$CHESS_LLAMA_TEST_TRACE"
case "$1" in
  info)
    printf 'Client:\n Version: 29.7.2\n\nServer:\npermission denied while connecting to Docker\n'
    exit 1
    ;;
  compose)
    printf 'Docker Compose version v5.3.1\n'
    ;;
  run)
    printf 'GPU runtime unavailable\n' >&2
    exit 1
    ;;
esac
EOF
}

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
  assert_stderr_contains "[ERROR] doctor: prerequisite checks failed exitCode=3"
}

@test "doctor human output is grouped compact and actionable" {
  install_doctor_status_fakes

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" doctor --format human

  [ "$status" -eq 3 ]
  assert_output_contains "Chess Llama Doctor"
  assert_output_contains "Status: NOT READY"
  assert_output_contains "Required for startup"
  assert_output_contains "Runtime status"
  assert_output_contains "[FAIL] Docker"
  assert_output_contains "[WARN] Model health"
  assert_output_contains "Next steps"
  assert_output_contains "Start Docker and ensure this user can access the Docker daemon."
  [[ $output != *$'\033['* ]]
  [[ $output != *$'\n Version: 29.7.2'* ]]
  while IFS= read -r line; do
    [ "${#line}" -le 140 ]
  done <<<"$output"
  assert_trace_contains 'info --format {{.ServerVersion}}'
}

@test "doctor colors status markers only on an eligible TTY" {
  install_doctor_status_fakes
  export TERM=xterm-256color
  unset NO_COLOR

  run --keep-empty-lines --separate-stderr script --quiet --return \
    --command "$PROJECT_ROOT/chess-llama doctor --format human" /dev/null

  [ "$status" -eq 3 ]
  [[ $output == *$'\033[31m[FAIL]\033[0m'* ]]

  export NO_COLOR=1
  run --keep-empty-lines --separate-stderr script --quiet --return \
    --command "$PROJECT_ROOT/chess-llama doctor --format human" /dev/null

  [ "$status" -eq 3 ]
  [[ $output != *$'\033['* ]]

  unset NO_COLOR
  export TERM=dumb
  run --keep-empty-lines --separate-stderr script --quiet --return \
    --command "$PROJECT_ROOT/chess-llama doctor --format human" /dev/null

  [ "$status" -eq 3 ]
  [[ $output != *$'\033['* ]]
}

@test "doctor optional warnings do not change ready status" {
  local report='{"ok":true,"prerequisitesOk":true,"checks":[{"name":"bash","ok":true,"detail":"5.2.21","requiredForDev":true},{"name":"model-health","ok":false,"detail":"health endpoint unavailable","requiredForDev":false}]}'

  run --keep-empty-lines --separate-stderr bash -c \
    'source "$1"; chess_llama_doctor_human_report "$2"' \
    _ "$PROJECT_ROOT/scripts/cli/doctor.sh" "$report"

  [ "$status" -eq 0 ]
  assert_output_contains "Status: READY (all required checks passed)"
  assert_output_contains "[WARN] Model health"
  [[ $output != *"Next steps"* ]]
}

@test "doctor bounds long remediation and prioritizes a missing operations build" {
  local long_path
  long_path=/$(
    printf 'directory%.0s' {1..24}
  )/models
  local report="{\"ok\":false,\"prerequisitesOk\":false,\"checks\":[{\"name\":\"nvidia\",\"ok\":false,\"detail\":\"Runtime manifest operation is unavailable\",\"requiredForDev\":true},{\"name\":\"xdg:models\",\"ok\":false,\"detail\":\"$long_path is not writable\",\"requiredForDev\":true},{\"name\":\"model-installed\",\"ok\":false,\"detail\":\"Runtime manifest operation is unavailable\",\"requiredForDev\":true}]}"

  run --keep-empty-lines --separate-stderr bash -c \
    'source "$1"; chess_llama_doctor_human_report "$2"' \
    _ "$PROJECT_ROOT/scripts/cli/doctor.sh" "$report"

  [ "$status" -eq 0 ]
  assert_output_contains "Run pnpm build before checking the runtime or model."
  while IFS= read -r line; do
    [ "${#line}" -le 140 ]
  done <<<"$output"
}

@test "doctor truncates human details without splitting Unicode characters" {
  local prefix
  prefix=$(printf 'a%.0s' {1..96})
  local report="{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[{\"name\":\"model-health\",\"ok\":false,\"detail\":\"${prefix}😀tail\",\"requiredForDev\":false}]}"

  run --keep-empty-lines --separate-stderr bash -c \
    'source "$1"; chess_llama_doctor_human_report "$2"' \
    _ "$PROJECT_ROOT/scripts/cli/doctor.sh" "$report"

  [ "$status" -eq 0 ]
  [[ $output == *"😀..."* ]]
  [[ $output != *"�"* ]]
}

@test "doctor keeps JSON as the default stable machine contract" {
  install_doctor_status_fakes

  run --separate-stderr "$PROJECT_ROOT/chess-llama" doctor

  [ "$status" -eq 3 ]
  JSON_ACTUAL=$output "$TEST_NODE" --input-type=module -e '
    import assert from "node:assert/strict";
    const report = JSON.parse(process.env.JSON_ACTUAL);
    assert.deepStrictEqual(Object.keys(report), ["ok", "prerequisitesOk", "checks"]);
    assert.equal(report.ok, false);
    assert.equal(report.prerequisitesOk, false);
    assert.ok(report.checks.length > 0);
    for (const check of report.checks) {
      assert.deepStrictEqual(Object.keys(check), ["name", "ok", "detail", "requiredForDev"]);
    }
    assert.match(report.checks.find((check) => check.name === "docker").detail, /\n/);
  '
}

@test "verbose doctor traces checks without contaminating JSON" {
  install_doctor_status_fakes

  run --separate-stderr "$PROJECT_ROOT/chess-llama" --verbose doctor --format json

  [ "$status" -eq 3 ]
  JSON_ACTUAL=$output "$TEST_NODE" --input-type=module -e 'JSON.parse(process.env.JSON_ACTUAL)'
  assert_stderr_contains "[DEBUG] doctor: running check check=docker"
  assert_stderr_contains "[DEBUG] doctor: run docker info --format"
  assert_stderr_contains "[DEBUG] doctor: checking path name=models"
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
  assert_stderr_contains "[INFO] dev: checking prerequisites"
  assert_stderr_contains "[ERROR] dev: prerequisite check failed exitCode=3"
  assert_stderr_contains "Chess Llama Doctor"
  assert_stderr_contains "Required for startup"
}

@test "dev reports reuse start supervision and the managed service that exits" {
  run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    source "$1/scripts/cli/core.sh"
    chess_llama_doctor_main() {
      printf "%s\n" "{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[]}"
    }
    chess_llama_database_main() { :; }
    chess_llama_model_status() {
      printf "%s\n" "{\"containerState\":\"running\",\"healthy\":true,\"modelId\":\"model.gguf\",\"profileId\":\"test-profile\",\"port\":8080}"
    }
    curl() { return 22; }
    ss() { printf "%s\n" "LISTEN 0 128 127.0.0.1:5173"; }
    setsid() { sleep 0.1; return 17; }
    chess_llama_dev_main
  ' _ "$PROJECT_ROOT"

  [ "$status" -eq 17 ]
  assert_stderr_contains "[OK] dev: prerequisites passed"
  assert_stderr_contains "[INFO] dev: reusing model runtime profile=test-profile"
  assert_stderr_contains "[INFO] dev: starting gateway url=http://127.0.0.1:3001"
  assert_stderr_contains "[INFO] dev: reusing client url=http://127.0.0.1:5173"
  assert_stderr_contains "[INFO] dev: service topology configured"
  [[ $stderr != *"[OK] dev: stack available"* ]]
  assert_stderr_contains "[ERROR] dev: managed service exited service=gateway exitCode=17"
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
