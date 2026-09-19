bats_require_minimum_version 1.5.0

chess_llama_test_setup() {
  TEST_CALLER_DIR=$PWD
  PROJECT_ROOT=$(cd "$BATS_TEST_DIRNAME/../.." && pwd -P)
  TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/chess-llama-bats.XXXXXX")
  TEST_BIN=$TEST_ROOT/bin
  TEST_NODE=$(command -v node)
  TEST_NODE_BIN=$(dirname "$TEST_NODE")

  export PROJECT_ROOT TEST_ROOT TEST_BIN TEST_NODE TEST_NODE_BIN TEST_CALLER_DIR
  export CHESS_LLAMA_PROJECT_ROOT=$PROJECT_ROOT
  export HOME=$TEST_ROOT/home
  export XDG_CONFIG_HOME=$TEST_ROOT/config
  export XDG_DATA_HOME=$TEST_ROOT/data
  export XDG_CACHE_HOME=$TEST_ROOT/cache
  export XDG_RUNTIME_DIR=$TEST_ROOT/run
  export XDG_STATE_HOME=$TEST_ROOT/state
  export PATH=$TEST_BIN:$TEST_NODE_BIN:/usr/bin:/bin

  mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_STATE_HOME" "$TEST_BIN"
  cd -- "$TEST_ROOT" || return
}

setup() {
  chess_llama_test_setup
}

teardown() {
  cd -- "$TEST_CALLER_DIR" || return
  rm -rf -- "$TEST_ROOT"
}

make_tool() {
  local name=$1
  {
    printf '#!/usr/bin/env bash\n'
    cat
  } >"$TEST_BIN/$name"
  chmod +x "$TEST_BIN/$name"
}

make_trace_tool() {
  make_tool "$1" <<'EOF'
printf '%s\n' "$0 $*" >>"$CHESS_LLAMA_TEST_TRACE"
printf 'DATABASE_PATH=%s\n' "${DATABASE_PATH-}" >>"$CHESS_LLAMA_TEST_TRACE"
EOF
}

assert_output_contains() {
  # Bats assigns output after run.
  # shellcheck disable=SC2154
  [[ $output == *"$1"* ]]
}

assert_stderr_contains() {
  [[ $stderr == *"$1"* ]]
}

assert_trace_contains() {
  grep -F -- "$1" "$CHESS_LLAMA_TEST_TRACE"
}

assert_json_equals() {
  JSON_ACTUAL=$1 JSON_EXPECTED=$2 node --input-type=module -e '
    import assert from "node:assert/strict";
    assert.deepStrictEqual(
      JSON.parse(process.env.JSON_ACTUAL),
      JSON.parse(process.env.JSON_EXPECTED),
    );
  '
}
