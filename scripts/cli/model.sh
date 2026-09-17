#!/usr/bin/env bash

chess_llama_model_help() {
  cat <<'EOF'
Usage: chess-llama model [command]

manage the local model

Commands:
  benchmark          qualify installed model profiles
  logs               show llama.cpp container logs
  pull               download and verify model weights
  start              start and qualify llama.cpp
  status             report llama.cpp status
  stop               stop llama.cpp
EOF
}

chess_llama_runtime_entry() {
  printf '%s\n' "${CHESS_LLAMA_RUNTIME_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/apps/operations/dist/runtime.js}"
}

chess_llama_runtime_value() {
  local entry
  entry=$(chess_llama_runtime_entry)
  chess_llama_require_operations_entry "$entry" || return
  CHESS_LLAMA_RUNTIME_MANIFEST=$CHESS_LLAMA_PROJECT_ROOT/config/runtime-manifest.json \
    node "$entry" "$@"
}

chess_llama_parse_profile_option() {
  CHESS_LLAMA_REQUESTED_PROFILE=''
  while (($#)); do
    case "$1" in
      --profile)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --profile requires a value'
          return
        }
        CHESS_LLAMA_REQUESTED_PROFILE=$1
        ;;
      *)
        chess_llama_input_error "Unknown option: $1"
        return
        ;;
    esac
    shift
  done
}

chess_llama_preferred_profile() {
  local database_entry=${CHESS_LLAMA_DATABASE_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/apps/operations/dist/database.js}
  if [[ -f $database_entry ]]; then
    local preference
    if preference=$(node "$database_entry" preferred-profile 2>/dev/null); then
      printf '%s' "$preference" | node --input-type=module -e '
        let source = "";
        for await (const chunk of process.stdin) source += chunk;
        process.stdout.write(JSON.parse(source).profileId ?? "");
      '
      return
    fi
  fi
  chess_llama_runtime_value default-profile
}

chess_llama_select_profile() {
  local profile=${CHESS_LLAMA_REQUESTED_PROFILE:-}
  if [[ -z $profile ]]; then
    profile=$(chess_llama_preferred_profile) || return
  fi
  if ! chess_llama_runtime_value profile "$profile" >/dev/null; then
    return "$CHESS_LLAMA_EXIT_INPUT"
  fi
  printf '%s\n' "$profile"
}

chess_llama_profile_field() {
  chess_llama_runtime_value profile-field "$1" "$2"
}

chess_llama_model_environment() {
  local profile=$1
  chess_llama_resolve_paths
  CHESS_LLAMA_IMAGE=$(chess_llama_runtime_value image) || return
  CHESS_LLAMA_MODEL_FILE=$(chess_llama_profile_field "$profile" file) || return
  CHESS_LLAMA_MODEL_PORT=${CHESS_LLAMA_MODEL_PORT:-8080}
  CHESS_LLAMA_PORT_BINDING=127.0.0.1:$CHESS_LLAMA_MODEL_PORT:8080
  CHESS_LLAMA_GPU_REQUEST='--gpus all'
  CHESS_LLAMA_CONTAINER=chess-llama-model
  export CHESS_LLAMA_IMAGE CHESS_LLAMA_MODEL_FILE CHESS_LLAMA_MODEL_PORT
  export CHESS_LLAMA_PORT_BINDING CHESS_LLAMA_GPU_REQUEST CHESS_LLAMA_CONTAINER
}

chess_llama_compose() {
  docker compose -f "$CHESS_LLAMA_COMPOSE_FILE" "$@"
}

chess_llama_model_lock() {
  local runtime_base=${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}
  local lock_dir=$runtime_base/chess-llama-${UID:-0}
  if ! mkdir -p -- "$lock_dir" 2>/dev/null; then
    lock_dir=${TMPDIR:-/tmp}/chess-llama-${UID:-0}
    mkdir -p -- "$lock_dir"
  fi
  exec 9>"$lock_dir/model.lock"
  if ! flock -n 9; then
    printf 'Another model lifecycle operation is already running\n' >&2
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
}

chess_llama_model_pull() {
  chess_llama_parse_profile_option "$@" || return
  local profile
  profile=$(chess_llama_select_profile) || return
  chess_llama_model_environment "$profile" || return
  chess_llama_model_lock || return
  mkdir -p -- "$CHESS_LLAMA_MODEL_DIR"
  chess_llama_compose pull llama || return "$CHESS_LLAMA_EXIT_PREREQUISITE"

  local destination=$CHESS_LLAMA_MODEL_DIR/$CHESS_LLAMA_MODEL_FILE
  local expected actual partial
  expected=$(chess_llama_profile_field "$profile" sha256) || return
  if [[ -f $destination ]]; then
    actual=$(sha256sum -- "$destination" | awk '{print $1}')
    if [[ $actual == "$expected" ]]; then
      return
    fi
    mv -- "$destination" "$destination.invalid-$(date +%s%3N)"
  fi

  partial=$destination.partial
  rm -f -- "$partial"
  trap 'rm -f -- "${partial:-}"' EXIT INT TERM
  local url
  url=$(chess_llama_profile_field "$profile" url) || return
  if ! curl --fail --show-error --location --retry 3 --output "$partial" "$url"; then
    printf 'Model download failed\n' >&2
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  actual=$(sha256sum -- "$partial" | awk '{print $1}')
  if [[ $actual != "$expected" ]]; then
    printf 'Model checksum mismatch for %s: expected %s, got %s\n' "$CHESS_LLAMA_MODEL_FILE" "$expected" "$actual" >&2
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  sync -f "$partial" 2>/dev/null || true
  mv -- "$partial" "$destination"
  trap - EXIT INT TERM
}

chess_llama_model_start() {
  chess_llama_parse_profile_option "$@" || return
  local profile
  profile=$(chess_llama_select_profile) || return
  chess_llama_model_environment "$profile" || return
  chess_llama_model_lock || return
  local destination=$CHESS_LLAMA_MODEL_DIR/$CHESS_LLAMA_MODEL_FILE
  local expected actual
  expected=$(chess_llama_profile_field "$profile" sha256) || return
  if [[ ! -f $destination ]]; then
    printf 'Model runtime start failed: model is not installed; run model pull --profile %s\n' "$profile" >&2
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  actual=$(sha256sum -- "$destination" | awk '{print $1}')
  if [[ $actual != "$expected" ]]; then
    printf 'Model runtime start failed: installed model checksum mismatch\n' >&2
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  chess_llama_compose up -d --force-recreate llama || {
    printf 'Model runtime start failed\n' >&2
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  }

  local timeout=${CHESS_LLAMA_HEALTH_TIMEOUT_SECONDS:-120}
  local deadline=$((SECONDS + timeout))
  until curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/health" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      printf 'Model runtime start failed: llama.cpp did not become healthy within %ss\n' "$timeout" >&2
      return "$CHESS_LLAMA_EXIT_HEALTH"
    fi
    sleep 1
  done
  local discovery model_id
  discovery=$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/models") || {
    printf 'Model runtime start failed: /v1/models health check failed\n' >&2
    return "$CHESS_LLAMA_EXIT_HEALTH"
  }
  model_id=$(printf '%s' "$discovery" | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const value = JSON.parse(source).data?.[0]?.id;
    if (typeof value !== "string") process.exit(1);
    process.stdout.write(value);
  ') || {
    printf 'Model runtime start failed: llama.cpp did not report a loaded model\n' >&2
    return "$CHESS_LLAMA_EXIT_HEALTH"
  }
  if [[ $model_id != "$CHESS_LLAMA_MODEL_FILE" ]]; then
    printf 'Model runtime start failed: llama.cpp loaded %s, expected %s\n' "$model_id" "$CHESS_LLAMA_MODEL_FILE" >&2
    return "$CHESS_LLAMA_EXIT_HEALTH"
  fi
}

chess_llama_model_stop() {
  (($# == 0)) || {
    chess_llama_input_error "Unknown option: $1"
    return
  }
  chess_llama_resolve_paths
  chess_llama_model_lock || return
  chess_llama_compose rm -s -f llama || return "$CHESS_LLAMA_EXIT_PREREQUISITE"
}

chess_llama_model_status() {
  chess_llama_parse_format "$@" || return
  chess_llama_resolve_paths
  local container_state=stopped healthy=false model_id='' profile_id=''
  local ps_output
  if ! ps_output=$(chess_llama_compose ps --status running --format json llama 2>/dev/null); then
    container_state=unknown
  elif [[ -n $ps_output ]]; then
    container_state=running
    if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/v1/health >/dev/null 2>&1; then
      healthy=true
      local discovery
      discovery=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/v1/models 2>/dev/null) || discovery=''
      if [[ -n $discovery ]]; then
        model_id=$(printf '%s' "$discovery" | node --input-type=module -e '
          let source = ""; for await (const chunk of process.stdin) source += chunk;
          process.stdout.write(JSON.parse(source).data?.[0]?.id ?? "");
        ' 2>/dev/null) || model_id=''
        if [[ -n $model_id ]]; then
          profile_id=$(chess_llama_runtime_value profile-id-for-file "$model_id" 2>/dev/null) || profile_id=''
        fi
      fi
    fi
  fi
  local output
  output=$(MODEL_STATE=$container_state MODEL_HEALTHY=$healthy MODEL_ID=$model_id MODEL_PROFILE=$profile_id node --input-type=module -e '
    const value = { containerState: process.env.MODEL_STATE, healthy: process.env.MODEL_HEALTHY === "true" };
    if (process.env.MODEL_ID) value.modelId = process.env.MODEL_ID;
    if (process.env.MODEL_PROFILE) value.profileId = process.env.MODEL_PROFILE;
    value.port = 8080;
    process.stdout.write(JSON.stringify(value));
  ')
  chess_llama_render_json "$CHESS_LLAMA_FORMAT" "$output"
}

chess_llama_model_logs() {
  (($# == 0)) || {
    chess_llama_input_error "Unknown option: $1"
    return
  }
  chess_llama_resolve_paths
  local temporary stdout_file stderr_file status output
  temporary=$(mktemp -d "${TMPDIR:-/tmp}/chess-llama-logs.XXXXXX") || return "$CHESS_LLAMA_EXIT_UNEXPECTED"
  stdout_file=$temporary/stdout
  stderr_file=$temporary/stderr
  if chess_llama_compose logs llama >"$stdout_file" 2>"$stderr_file"; then
    status=0
  else
    status=$?
  fi
  output=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const stripFinalNewline = (value) => value.replace(/\r?\n$/, "");
    process.stdout.write(JSON.stringify({
      exitCode: Number(process.argv[3]),
      stdout: stripFinalNewline(readFileSync(process.argv[1], "utf8")),
      stderr: stripFinalNewline(readFileSync(process.argv[2], "utf8")),
    }));
  ' "$stdout_file" "$stderr_file" "$status") || {
    rm -rf -- "$temporary"
    return "$CHESS_LLAMA_EXIT_UNEXPECTED"
  }
  rm -rf -- "$temporary"
  printf '%s\n' "$output"
  return "$status"
}

chess_llama_model_benchmark() {
  local format=human
  local -a profiles=()
  while (($#)); do
    case "$1" in
      --profile)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --profile requires a value'
          return
        }
        profiles+=("$1")
        ;;
      --format)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --format requires a value'
          return
        }
        format=$1
        ;;
      *)
        chess_llama_input_error "Unknown option: $1"
        return
        ;;
    esac
    shift
  done
  if [[ $format != json && $format != human ]]; then
    chess_llama_input_error "Unsupported output format: $format"
    return
  fi

  local entry=${CHESS_LLAMA_BENCHMARK_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/apps/operations/dist/benchmark.js}
  chess_llama_require_operations_entry "$entry" || return
  chess_llama_resolve_paths
  export CHESS_LLAMA_PROJECT_ROOT
  export CHESS_LLAMA_RUNTIME_MANIFEST=$CHESS_LLAMA_PROJECT_ROOT/config/runtime-manifest.json
  local report
  report=$(node "$entry" run "${profiles[@]}") || return $?
  if [[ $format == json ]]; then
    printf '%s\n' "$report"
  else
    local rows
    rows=$(printf '%s' "$report" | node "$entry" rows) || return "$CHESS_LLAMA_EXIT_UNEXPECTED"
    chess_llama_render_json human "$rows"
  fi
  if [[ $report != *'"qualified":true'* ]]; then
    printf 'Benchmark qualification failed\n' >&2
    return "$CHESS_LLAMA_EXIT_UNEXPECTED"
  fi
}

chess_llama_model_main() {
  local command=${1:-}
  case "$command" in
    '' | -h | --help | help) chess_llama_model_help ;;
    pull)
      shift
      chess_llama_model_pull "$@"
      ;;
    start)
      shift
      chess_llama_model_start "$@"
      ;;
    stop)
      shift
      chess_llama_model_stop "$@"
      ;;
    status)
      shift
      chess_llama_model_status "$@"
      ;;
    logs)
      shift
      chess_llama_model_logs "$@"
      ;;
    benchmark)
      shift
      chess_llama_model_benchmark "$@"
      ;;
    *) chess_llama_input_error "Unknown model command: $command" ;;
  esac
}
