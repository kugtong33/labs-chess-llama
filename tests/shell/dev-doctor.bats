#!/usr/bin/env bats
# Lifecycle assertions intentionally match literal shell variable references.
# shellcheck disable=SC2016

load test_helper

project_pnpm_version() {
  "$TEST_NODE" --input-type=module -e '
    import { readFileSync } from "node:fs";
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const match = /^pnpm@(.+)$/.exec(manifest.packageManager ?? "");
    if (match?.[1] === undefined) process.exit(1);
    process.stdout.write(match[1]);
  ' "$PROJECT_ROOT/package.json"
}

install_doctor_status_fakes() {
  export CHESS_LLAMA_TEST_TRACE=$TEST_ROOT/doctor-trace
  export CHESS_LLAMA_TEST_PNPM_VERSION
  CHESS_LLAMA_TEST_PNPM_VERSION=$(project_pnpm_version)
  make_tool pnpm <<'EOF'
printf '%s\n' "$CHESS_LLAMA_TEST_PNPM_VERSION"
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

@test "doctor accepts the pnpm version declared by the project manifest" {
  install_doctor_status_fakes
  local expected
  expected=$(project_pnpm_version)

  run --separate-stderr "$PROJECT_ROOT/chess-llama" doctor --format json

  [ "$status" -eq 3 ]
  JSON_ACTUAL=$output PNPM_EXPECTED=$expected "$TEST_NODE" --input-type=module -e '
    import assert from "node:assert/strict";
    const report = JSON.parse(process.env.JSON_ACTUAL);
    const check = report.checks.find((item) => item.name === "pnpm");
    assert.equal(check.ok, true);
    assert.equal(check.detail, process.env.PNPM_EXPECTED);
  '
}

@test "doctor explains a pnpm mismatch using the manifest version" {
  install_doctor_status_fakes
  local expected
  expected=$(project_pnpm_version)
  make_tool pnpm <<'EOF'
printf '0.0.0\n'
EOF

  run --keep-empty-lines --separate-stderr "$PROJECT_ROOT/chess-llama" doctor --format human

  [ "$status" -eq 3 ]
  assert_output_contains "0.0.0 (expected $expected)"
  assert_output_contains "Run corepack prepare pnpm@$expected --activate."
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

@test "doctor validates Homebrew llama-server and Metal without requiring Docker on Apple Silicon" {
  local model_dir=$TEST_ROOT/models
  mkdir -p "$model_dir"
  printf 'verified model' >"$model_dir/model.gguf"
  export CHESS_LLAMA_MODEL_DIR=$model_dir
  export CHESS_LLAMA_TEST_PNPM_VERSION
  CHESS_LLAMA_TEST_PNPM_VERSION=$(project_pnpm_version)
  make_tool pnpm <<'EOF'
printf '%s\n' "$CHESS_LLAMA_TEST_PNPM_VERSION"
EOF
  make_tool llama-server <<'EOF'
case "$1" in
  --help) printf '%s\n' '--host --port --ctx-size --n-gpu-layers --flash-attn --parallel --alias --no-webui' ;;
  --list-devices) printf '%s\n' 'Metal: Apple M3 Max' ;;
esac
EOF
  make_tool docker <<'EOF'
printf 'Docker must not be checked by the native provider\n' >&2
exit 99
EOF
  make_tool curl <<'EOF'
exit 22
EOF

  run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    source "$1/scripts/cli/core.sh"
    chess_llama_runtime_provider() { printf "native-metal\n"; }
    chess_llama_port_in_use() { return 1; }
    chess_llama_preferred_profile() { printf "test-profile\n"; }
    chess_llama_profile_field() {
      case "$2" in
        file) printf "model.gguf\n" ;;
        sha256) printf "expected\n" ;;
      esac
    }
    chess_llama_hash_file() { printf "expected\n"; }
    chess_llama_doctor_main --format json
  ' _ "$PROJECT_ROOT"

  [ "$status" -eq 0 ]
  JSON_ACTUAL=$output "$TEST_NODE" --input-type=module -e '
    import assert from "node:assert/strict";
    const report = JSON.parse(process.env.JSON_ACTUAL);
    assert.equal(report.prerequisitesOk, true);
    assert.equal(report.checks.some((check) => check.name === "docker"), false);
    assert.equal(report.checks.find((check) => check.name === "llama-server")?.ok, true);
    assert.equal(report.checks.find((check) => check.name === "metal")?.ok, true);
    assert.equal(report.checks.find((check) => check.name === "xdg:state")?.ok, true);
  '
  [[ ${stderr:-} != *'Docker must not be checked'* ]]
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

@test "dev does not claim or stop a model runtime when startup fails" {
  local model_stop_trace=$TEST_ROOT/failed-model-stop
  run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    CHESS_LLAMA_TEST_TRACE=$2
    source "$1/scripts/cli/core.sh"
    chess_llama_doctor_main() { printf "%s\n" "{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[]}"; }
    chess_llama_database_main() { :; }
    chess_llama_model_status() { printf "%s\n" "{\"provider\":\"native-metal\",\"runtimeState\":\"stopped\",\"healthy\":false,\"port\":8080}"; }
    chess_llama_model_start() { return 4; }
    chess_llama_model_stop() { printf "unsafe stop\n" >"$CHESS_LLAMA_TEST_TRACE"; }
    chess_llama_dev_main
  ' _ "$PROJECT_ROOT" "$model_stop_trace"

  [ "$status" -eq 4 ]
  [ ! -e "$model_stop_trace" ]
}

@test "dev reports reuse start supervision and the managed service that exits" {
  local model_stop_trace=$TEST_ROOT/external-model-stop
  run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    CHESS_LLAMA_TEST_TRACE=$2
    source "$1/scripts/cli/core.sh"
    chess_llama_doctor_main() {
      printf "%s\n" "{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[]}"
    }
    chess_llama_database_main() { :; }
    chess_llama_model_status() {
      printf "%s\n" "{\"provider\":\"native-metal\",\"runtimeState\":\"external\",\"healthy\":true,\"modelId\":\"test-profile\",\"profileId\":\"test-profile\",\"port\":8080}"
    }
    chess_llama_model_stop() { printf "unsafe stop\n" >"$CHESS_LLAMA_TEST_TRACE"; return 99; }
    curl() { return 22; }
    chess_llama_port_in_use() { return 0; }
    chess_llama_supervise() { sleep 0.1; return 17; }
    chess_llama_dev_main
  ' _ "$PROJECT_ROOT" "$model_stop_trace"

  [ "$status" -eq 17 ]
  assert_stderr_contains "[OK] dev: prerequisites passed"
  assert_stderr_contains "[INFO] dev: reusing model runtime profile=test-profile"
  assert_stderr_contains "[INFO] dev: starting backend url=http://127.0.0.1:3001"
  assert_stderr_contains "[INFO] dev: reusing web url=http://127.0.0.1:5173"
  assert_stderr_contains "[INFO] dev: service topology configured"
  [[ $stderr != *"[OK] dev: stack available"* ]]
  assert_stderr_contains "[ERROR] dev: managed service exited service=backend exitCode=17"
  [ ! -e "$model_stop_trace" ]
}

@test "dev enables decision tracing by default and honors an explicit zero" {
  local trace=$TEST_ROOT/dev-trace
  run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    CHESS_LLAMA_TEST_TRACE=$2
    source "$1/scripts/cli/core.sh"
    chess_llama_doctor_main() { printf "%s\n" "{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[]}"; }
    chess_llama_database_main() { :; }
    chess_llama_model_status() { printf "%s\n" "{\"healthy\":true}"; }
    curl() { return 22; }
    chess_llama_port_in_use() { return 1; }
    chess_llama_supervise() { printf "trace=%s\n" "$CHESS_LLAMA_DEMO_TRACE" >>"$CHESS_LLAMA_TEST_TRACE"; sleep 0.1; return 17; }
    chess_llama_dev_main
  ' _ "$PROJECT_ROOT" "$trace"

  [ "$status" -eq 17 ]
  [ "$(head -1 "$trace")" = 'trace=1' ]
  assert_stderr_contains "[INFO] dev: decision trace endpoint enabled"

  CHESS_LLAMA_DEMO_TRACE=0 run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    CHESS_LLAMA_TEST_TRACE=$2
    source "$1/scripts/cli/core.sh"
    chess_llama_doctor_main() { printf "%s\n" "{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[]}"; }
    chess_llama_database_main() { :; }
    chess_llama_model_status() { printf "%s\n" "{\"healthy\":true}"; }
    curl() { return 22; }
    chess_llama_port_in_use() { return 1; }
    chess_llama_supervise() { printf "trace=%s\n" "$CHESS_LLAMA_DEMO_TRACE" >"$CHESS_LLAMA_TEST_TRACE"; sleep 0.1; return 17; }
    chess_llama_dev_main
  ' _ "$PROJECT_ROOT" "$trace"

  [ "$status" -eq 17 ]
  [ "$(cat "$trace")" = 'trace=0' ]
  assert_stderr_contains "[INFO] dev: decision trace endpoint disabled"
}

@test "dev cleanup reacquires the lifecycle lock to stop its owned model" {
  local trace=$TEST_ROOT/model-stop-trace
  run --separate-stderr bash -c '
    set -Eeuo pipefail
    CHESS_LLAMA_PROJECT_ROOT=$1
    CHESS_LLAMA_TEST_TRACE=$2
    source "$1/scripts/cli/core.sh"
    chess_llama_doctor_main() { printf "%s\n" "{\"ok\":true,\"prerequisitesOk\":true,\"checks\":[]}"; }
    chess_llama_database_main() { :; }
    chess_llama_model_status() { printf "%s\n" "{\"healthy\":false}"; }
    chess_llama_model_start() { chess_llama_model_lock; }
    chess_llama_model_stop() { chess_llama_model_lock && printf "stopped\n" >"$CHESS_LLAMA_TEST_TRACE"; }
    curl() { return 22; }
    chess_llama_port_in_use() { return 0; }
    chess_llama_supervise() {
      sleep 2 </dev/null >/dev/null 2>&1 &
      sleep 0.1
      return 17
    }
    chess_llama_dev_main
  ' _ "$PROJECT_ROOT" "$trace"

  [ "$status" -eq 17 ]
  [ "$(cat "$trace")" = stopped ]
  assert_stderr_contains "[INFO] dev: stopping owned model runtime"
  [[ $stderr != *"owned model runtime cleanup failed"* ]]
}

@test "dev isolates children and terminates process groups in reverse order" {
  local dev_source web_prefix backend_prefix
  dev_source=$(<"$PROJECT_ROOT/scripts/cli/dev.sh")

  [[ $dev_source == *'chess_llama_supervise "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" backend start &'* ]]
  [[ $dev_source == *'chess_llama_supervise "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" web dev &'* ]]
  [[ $dev_source == *'chess_llama_port_in_use 5173'* ]]
  [[ $dev_source == *'"$CHESS_LLAMA_DEV_WEB_PID"'* ]]
  [[ $dev_source == *'"$CHESS_LLAMA_DEV_BACKEND_PID"'* ]]
  web_prefix=${dev_source%%'"$CHESS_LLAMA_DEV_WEB_PID"'*}
  backend_prefix=${dev_source%%'"$CHESS_LLAMA_DEV_BACKEND_PID"'*}
  [ "${#web_prefix}" -lt "${#backend_prefix}" ]
  [[ $dev_source == *'kill -TERM -- "-$pid"'* ]]
}
