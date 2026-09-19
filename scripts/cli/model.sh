#!/usr/bin/env bash

readonly CHESS_LLAMA_DEFAULT_IMAGE='ghcr.io/ggml-org/llama.cpp@sha256:5268283a8d6510d167364f19aee93e98180d8eb0cac4b7edb20af7e3edf40c17'

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
  printf '%s\n' "${CHESS_LLAMA_RUNTIME_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/runtime.js}"
}

chess_llama_runtime_value() {
  local entry
  entry=$(chess_llama_runtime_entry)
  chess_llama_require_operations_entry "$entry" model || return
  CHESS_LLAMA_RUNTIME_MANIFEST=$CHESS_LLAMA_PROJECT_ROOT/config/runtime-manifest.json \
    node "$entry" "$@"
}

chess_llama_runtime_image() {
  local image
  image=$(chess_llama_runtime_value image) || return
  if [[ -z ${image//[[:space:]]/} ]]; then
    image=$CHESS_LLAMA_DEFAULT_IMAGE
    chess_llama_warn runtime 'manifest returned an empty image; using pinned default' image "$image"
  fi
  printf '%s\n' "$image"
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
  local database_entry=${CHESS_LLAMA_DATABASE_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/database.js}
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
  local source=explicit
  if [[ -z $profile ]]; then
    source=settings
    local database_entry=${CHESS_LLAMA_DATABASE_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/database.js}
    local preference=''
    if [[ -f $database_entry ]]; then
      preference=$(node "$database_entry" preferred-profile 2>/dev/null) || preference=''
      if [[ -n $preference ]]; then
        profile=$(printf '%s' "$preference" | node --input-type=module -e '
          let source = "";
          for await (const chunk of process.stdin) source += chunk;
          process.stdout.write(JSON.parse(source).profileId ?? "");
        ' 2>/dev/null) || profile=''
      fi
    fi
    if [[ -z $profile ]]; then
      source=manifest-default
      profile=$(chess_llama_runtime_value default-profile) || return
    fi
  fi
  if ! chess_llama_runtime_value profile "$profile" >/dev/null; then
    chess_llama_error model 'profile selection failed' profile "$profile" source "$source"
    return "$CHESS_LLAMA_EXIT_INPUT"
  fi
  CHESS_LLAMA_SELECTED_PROFILE=$profile
  CHESS_LLAMA_PROFILE_SOURCE=$source
}

chess_llama_profile_field() {
  chess_llama_runtime_value profile-field "$1" "$2"
}

chess_llama_model_environment() {
  local profile=$1
  chess_llama_resolve_paths
  CHESS_LLAMA_PROVIDER=$(chess_llama_runtime_provider) || return
  CHESS_LLAMA_MODEL_FILE=$(chess_llama_profile_field "$profile" file) || return
  CHESS_LLAMA_MODEL_PORT=${CHESS_LLAMA_MODEL_PORT:-8080}
  if [[ $CHESS_LLAMA_PROVIDER == docker-cuda ]]; then
    CHESS_LLAMA_IMAGE=$(chess_llama_runtime_image) || return
    CHESS_LLAMA_PORT_BINDING=127.0.0.1:$CHESS_LLAMA_MODEL_PORT:8080
    CHESS_LLAMA_GPU_REQUEST='--gpus all'
    CHESS_LLAMA_CONTAINER=chess-llama-model
    export CHESS_LLAMA_IMAGE CHESS_LLAMA_PORT_BINDING CHESS_LLAMA_GPU_REQUEST CHESS_LLAMA_CONTAINER
  else
    CHESS_LLAMA_CONTEXT_SIZE=$(chess_llama_profile_field "$profile" contextSize) || return
    export CHESS_LLAMA_CONTEXT_SIZE
  fi
  export CHESS_LLAMA_PROVIDER CHESS_LLAMA_MODEL_FILE CHESS_LLAMA_MODEL_PORT
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
  chess_llama_select_profile || return
  local profile=$CHESS_LLAMA_SELECTED_PROFILE
  chess_llama_model_environment "$profile" || return
  if [[ $CHESS_LLAMA_PROVIDER == docker-cuda ]]; then
    chess_llama_info model 'selected profile' profile "$profile" source "$CHESS_LLAMA_PROFILE_SOURCE" \
      file "$CHESS_LLAMA_MODEL_FILE" directory "$CHESS_LLAMA_MODEL_DIR" image "$CHESS_LLAMA_IMAGE"
    chess_llama_model_lock || return
  else
    chess_llama_info model 'selected profile' profile "$profile" source "$CHESS_LLAMA_PROFILE_SOURCE" \
      file "$CHESS_LLAMA_MODEL_FILE" directory "$CHESS_LLAMA_MODEL_DIR" provider "$CHESS_LLAMA_PROVIDER"
  fi
  mkdir -p -- "$CHESS_LLAMA_MODEL_DIR"
  if [[ $CHESS_LLAMA_PROVIDER == docker-cuda ]]; then
    chess_llama_docker_model_prepare || return
  fi

  local destination=$CHESS_LLAMA_MODEL_DIR/$CHESS_LLAMA_MODEL_FILE
  local expected url result status
  expected=$(chess_llama_profile_field "$profile" sha256) || return
  url=$(chess_llama_profile_field "$profile" url) || return
  chess_llama_info model 'installing verified weights' source "$(chess_llama_sanitize_url "$url")" \
    destination "$destination" expected "$expected"
  if result=$(chess_llama_install_artifact "$destination" "$expected" "$url"); then
    if [[ $result == *'"status":"reused"'* ]]; then
      chess_llama_ok model 'weights already installed' path "$destination" checksum "$expected"
    else
      chess_llama_ok model 'weights installed' profile "$profile" path "$destination" checksum "$expected"
    fi
  else
    status=$?
    chess_llama_error model 'artifact installation failed' destination "$destination" exitCode "$status"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
}

chess_llama_model_start() {
  chess_llama_parse_profile_option "$@" || return
  chess_llama_select_profile || return
  local profile=$CHESS_LLAMA_SELECTED_PROFILE
  chess_llama_model_environment "$profile" || return
  if [[ $CHESS_LLAMA_PROVIDER == docker-cuda ]]; then
    chess_llama_info model 'starting runtime' profile "$profile" source "$CHESS_LLAMA_PROFILE_SOURCE" \
      file "$CHESS_LLAMA_MODEL_FILE" image "$CHESS_LLAMA_IMAGE" port "$CHESS_LLAMA_MODEL_PORT" \
      compose "$CHESS_LLAMA_COMPOSE_FILE"
    chess_llama_model_lock || return
  else
    chess_llama_info model 'starting runtime' profile "$profile" source "$CHESS_LLAMA_PROFILE_SOURCE" \
      file "$CHESS_LLAMA_MODEL_FILE" provider "$CHESS_LLAMA_PROVIDER" port "$CHESS_LLAMA_MODEL_PORT"
  fi
  local destination=$CHESS_LLAMA_MODEL_DIR/$CHESS_LLAMA_MODEL_FILE
  local expected actual
  expected=$(chess_llama_profile_field "$profile" sha256) || return
  if [[ ! -f $destination ]]; then
    chess_llama_error model 'runtime start failed: weights are not installed' path "$destination" \
      remedy "run model pull --profile $profile"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  chess_llama_info model 'verifying installed weights' path "$destination" expected "$expected"
  actual=$(chess_llama_hash_file "$destination") || {
    local status=$?
    chess_llama_error model 'runtime start failed: unable to hash installed weights' \
      path "$destination" exitCode "$status"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  }
  if [[ $actual != "$expected" ]]; then
    chess_llama_error model 'runtime start failed: installed weight checksum mismatch' expected "$expected" actual "$actual"
    return "$CHESS_LLAMA_EXIT_RUNTIME"
  fi
  chess_llama_ok model 'installed weights verified' path "$destination" checksum "$actual"
  case "$CHESS_LLAMA_PROVIDER" in
    docker-cuda) chess_llama_docker_model_start "$profile" "$destination" || return ;;
    native-metal) chess_llama_native_model_start "$profile" "$destination" || return ;;
  esac

  local timeout=${CHESS_LLAMA_HEALTH_TIMEOUT_SECONDS:-120}
  local deadline=$((SECONDS + timeout))
  local started=$SECONDS
  chess_llama_info model 'waiting for runtime health' endpoint "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/health" timeoutSeconds "$timeout"
  chess_llama_debug_command model curl --fail --silent --show-error --max-time 2 \
    "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/health"
  until curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/health" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      chess_llama_error model 'runtime health timed out' endpoint "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/health" \
        timeoutSeconds "$timeout"
      return "$CHESS_LLAMA_EXIT_HEALTH"
    fi
    sleep 1
    chess_llama_debug model 'runtime is not healthy yet' elapsedSeconds "$((SECONDS - started))" timeoutSeconds "$timeout"
  done
  chess_llama_ok model 'runtime health check passed' endpoint "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/health"
  local discovery model_id
  chess_llama_debug model 'discovering loaded model' endpoint "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/models"
  chess_llama_debug_command model curl --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/models"
  discovery=$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/models") || {
    local status=$?
    chess_llama_error model 'model discovery failed' endpoint "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT/v1/models" exitCode "$status"
    return "$CHESS_LLAMA_EXIT_HEALTH"
  }
  model_id=$(printf '%s' "$discovery" | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const value = JSON.parse(source).data?.[0]?.id;
    if (typeof value !== "string") process.exit(1);
    process.stdout.write(value);
  ') || {
    chess_llama_error model 'runtime did not report a loaded model'
    return "$CHESS_LLAMA_EXIT_HEALTH"
  }
  if [[ $model_id != "$CHESS_LLAMA_MODEL_FILE" && $model_id != "$profile" ]]; then
    chess_llama_error model 'loaded model does not match profile' loaded "$model_id" \
      expected "$CHESS_LLAMA_MODEL_FILE" profile "$profile"
    return "$CHESS_LLAMA_EXIT_HEALTH"
  fi
  chess_llama_ok model 'runtime ready' profile "$profile" model "$model_id" url "http://127.0.0.1:$CHESS_LLAMA_MODEL_PORT"
}

chess_llama_model_stop() {
  (($# == 0)) || {
    chess_llama_input_error "Unknown option: $1"
    return
  }
  chess_llama_resolve_paths
  local provider
  provider=$(chess_llama_runtime_provider) || return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  if [[ $provider == native-metal ]]; then
    chess_llama_native_model_stop
    return
  fi
  chess_llama_select_profile || return
  local profile=$CHESS_LLAMA_SELECTED_PROFILE
  chess_llama_model_environment "$profile" || return
  chess_llama_model_lock || return
  chess_llama_docker_model_stop
}

chess_llama_model_status() {
  chess_llama_parse_format "$@" || return
  chess_llama_resolve_paths
  local provider
  provider=$(chess_llama_runtime_provider) || {
    chess_llama_error model 'runtime provider detection failed'
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  }
  chess_llama_debug model 'checking runtime status' provider "$provider" endpoint http://127.0.0.1:8080/v1/health
  local runtime_state=stopped healthy=false model_id='' profile_id=''
  local status lifecycle probe_health=false
  if [[ $provider == docker-cuda ]]; then
    runtime_state=$(chess_llama_docker_model_status) || return
    [[ $runtime_state == running ]] && probe_health=true
  else
    if lifecycle=$(chess_llama_native_model_status); then
      runtime_state=$(printf '%s' "$lifecycle" | node --input-type=module -e '
        let source = ""; for await (const chunk of process.stdin) source += chunk;
        process.stdout.write(JSON.parse(source).runtimeState);
      ') || runtime_state=unknown
    else
      status=$?
      runtime_state=unknown
      chess_llama_warn model 'native process state probe failed' state "$CHESS_LLAMA_STATE_DIR" exitCode "$status"
    fi
    probe_health=true
  fi
  if [[ $probe_health == true ]]; then
    chess_llama_debug_command model curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/v1/health
    if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/v1/health >/dev/null 2>&1; then
      healthy=true
      if [[ $provider == native-metal && $runtime_state == stopped ]]; then
        runtime_state=external
      fi
      local discovery
      chess_llama_debug_command model curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/v1/models
      if discovery=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/v1/models 2>/dev/null); then
        if [[ -n $discovery ]]; then
          if model_id=$(printf '%s' "$discovery" | node --input-type=module -e '
            let source = ""; for await (const chunk of process.stdin) source += chunk;
            process.stdout.write(JSON.parse(source).data?.[0]?.id ?? "");
          ' 2>/dev/null); then
            if [[ -n $model_id ]]; then
              if chess_llama_runtime_value profile "$model_id" >/dev/null 2>&1; then
                profile_id=$model_id
              else
                profile_id=$(chess_llama_runtime_value profile-id-for-file "$model_id" 2>/dev/null) || profile_id=''
              fi
            fi
          else
            model_id=''
            chess_llama_warn model 'model discovery response was invalid' endpoint http://127.0.0.1:8080/v1/models
          fi
        fi
      else
        status=$?
        chess_llama_warn model 'model discovery probe failed' endpoint http://127.0.0.1:8080/v1/models exitCode "$status"
      fi
    else
      status=$?
      if [[ $runtime_state == running ]]; then
        chess_llama_warn model 'runtime health probe failed' endpoint http://127.0.0.1:8080/v1/health exitCode "$status"
      fi
    fi
  fi
  local output
  output=$(MODEL_PROVIDER=$provider MODEL_STATE=$runtime_state MODEL_HEALTHY=$healthy MODEL_ID=$model_id MODEL_PROFILE=$profile_id node --input-type=module -e '
    const value = { provider: process.env.MODEL_PROVIDER, runtimeState: process.env.MODEL_STATE, healthy: process.env.MODEL_HEALTHY === "true" };
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
  local provider
  provider=$(chess_llama_runtime_provider) || return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  case "$provider" in
    docker-cuda) chess_llama_docker_model_logs ;;
    native-metal) chess_llama_native_model_logs ;;
  esac
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

  local entry=${CHESS_LLAMA_BENCHMARK_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/benchmark.js}
  chess_llama_require_operations_entry "$entry" model || return
  chess_llama_resolve_paths
  export CHESS_LLAMA_PROJECT_ROOT
  export CHESS_LLAMA_RUNTIME_MANIFEST=$CHESS_LLAMA_PROJECT_ROOT/config/runtime-manifest.json
  local report
  chess_llama_debug model 'running benchmark' entry "$entry" profiles "${profiles[*]:-all}" format "$format"
  chess_llama_debug_command model node "$entry" run "${profiles[@]}"
  report=$(node "$entry" run "${profiles[@]}") || {
    local status=$?
    chess_llama_error model 'benchmark execution failed' entry "$entry" exitCode "$status"
    return "$status"
  }
  if [[ $format == json ]]; then
    printf '%s\n' "$report"
  else
    local rows
    rows=$(printf '%s' "$report" | node "$entry" rows) || return "$CHESS_LLAMA_EXIT_UNEXPECTED"
    chess_llama_render_json human "$rows"
  fi
  if [[ $report != *'"qualified":true'* ]]; then
    chess_llama_error model 'benchmark qualification failed'
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
