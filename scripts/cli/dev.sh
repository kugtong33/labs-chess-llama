#!/usr/bin/env bash

CHESS_LLAMA_DEV_MODEL_OWNED=false
CHESS_LLAMA_DEV_GATEWAY_PID=''
CHESS_LLAMA_DEV_CLIENT_PID=''
CHESS_LLAMA_DEV_CLEANED=false
CHESS_LLAMA_DEV_SHUTDOWN_REASON='command exit'

chess_llama_dev_cleanup() {
  if [[ $CHESS_LLAMA_DEV_CLEANED == true ]]; then
    return
  fi
  CHESS_LLAMA_DEV_CLEANED=true
  chess_llama_info dev 'cleaning up owned resources' reason "$CHESS_LLAMA_DEV_SHUTDOWN_REASON"
  local pid service index
  local -a pids=("$CHESS_LLAMA_DEV_CLIENT_PID" "$CHESS_LLAMA_DEV_GATEWAY_PID")
  local -a services=(client gateway)
  for index in 0 1; do
    pid=${pids[$index]}
    service=${services[$index]}
    if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
      chess_llama_info dev 'stopping managed service' service "$service" pid "$pid"
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      chess_llama_ok dev 'managed service stopped' service "$service" pid "$pid"
    fi
  done
  if [[ $CHESS_LLAMA_DEV_MODEL_OWNED == true ]]; then
    chess_llama_info dev 'stopping owned model runtime'
    chess_llama_model_stop || chess_llama_warn dev 'owned model runtime cleanup failed'
  fi
}

chess_llama_dev_signal() {
  CHESS_LLAMA_DEV_SHUTDOWN_REASON="signal ${1:-received}"
  chess_llama_dev_cleanup
  exit 0
}

chess_llama_dev_main() {
  if [[ ${1:-} == -h || ${1:-} == --help || ${1:-} == help ]]; then
    printf 'Usage: chess-llama dev\n\nstart the local development stack\n'
    return
  fi
  (($# == 0)) || {
    chess_llama_input_error "Unknown option: $1"
    return
  }
  local doctor_report doctor_status=0
  chess_llama_info dev 'checking prerequisites'
  doctor_report=$(chess_llama_doctor_main --format json) || doctor_status=$?
  if ((doctor_status != 0)); then
    chess_llama_error dev 'prerequisite check failed' exitCode "$doctor_status"
    if [[ -n $doctor_report ]]; then
      chess_llama_doctor_human_report "$doctor_report" >&2
    fi
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  fi
  chess_llama_ok dev 'prerequisites passed'

  chess_llama_resolve_paths
  chess_llama_info dev 'preparing database' database "$CHESS_LLAMA_DATABASE_FILE"
  chess_llama_database_main migrate || return $?

  if [[ ${CHESS_LLAMA_DEMO_TRACE:-} == 0 ]]; then
    chess_llama_info dev 'decision trace endpoint disabled' url http://127.0.0.1:3001/api/demo/events
  else
    CHESS_LLAMA_DEMO_TRACE=1
    export CHESS_LLAMA_DEMO_TRACE
    chess_llama_info dev 'decision trace endpoint enabled' url http://127.0.0.1:3001/api/demo/events
  fi

  CHESS_LLAMA_DEV_MODEL_OWNED=false
  CHESS_LLAMA_DEV_GATEWAY_PID=''
  CHESS_LLAMA_DEV_CLIENT_PID=''
  CHESS_LLAMA_DEV_CLEANED=false
  CHESS_LLAMA_DEV_SHUTDOWN_REASON='command exit'
  trap 'chess_llama_dev_signal INT' INT
  trap 'chess_llama_dev_signal TERM' TERM
  trap chess_llama_dev_cleanup EXIT

  local model_status='' model_profile=''
  model_status=$(chess_llama_model_status --format json) || true
  if [[ $model_status != *'"healthy":true'* ]]; then
    CHESS_LLAMA_DEV_MODEL_OWNED=true
    chess_llama_info dev 'starting model runtime' url http://127.0.0.1:8080
    chess_llama_model_start || return $?
  else
    model_profile=$(printf '%s' "$model_status" | node --input-type=module -e '
      let source = "";
      for await (const chunk of process.stdin) source += chunk;
      process.stdout.write(JSON.parse(source).profileId ?? "unknown");
    ' 2>/dev/null) || model_profile=unknown
    chess_llama_info dev 'reusing model runtime' profile "$model_profile" url http://127.0.0.1:8080
  fi

  chess_llama_debug dev 'probing gateway' endpoint http://127.0.0.1:3001/api/health
  if ! curl --fail --silent --show-error --max-time 1 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    chess_llama_info dev 'starting gateway' url http://127.0.0.1:3001 database "$CHESS_LLAMA_DATABASE_FILE"
    setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" gateway start &
    CHESS_LLAMA_DEV_GATEWAY_PID=$!
    chess_llama_debug dev 'gateway process started' pid "$CHESS_LLAMA_DEV_GATEWAY_PID"
  else
    chess_llama_info dev 'reusing gateway' url http://127.0.0.1:3001
  fi

  chess_llama_debug dev 'probing client port' port 5173
  if ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)5173$'; then
    chess_llama_info dev 'starting client' url http://127.0.0.1:5173
    setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" client dev &
    CHESS_LLAMA_DEV_CLIENT_PID=$!
    chess_llama_debug dev 'client process started' pid "$CHESS_LLAMA_DEV_CLIENT_PID"
  else
    chess_llama_info dev 'reusing client' url http://127.0.0.1:5173
  fi

  chess_llama_info dev 'service topology configured' client http://127.0.0.1:5173 \
    gateway http://127.0.0.1:3001 model http://127.0.0.1:8080

  local -a children=()
  [[ -n $CHESS_LLAMA_DEV_GATEWAY_PID ]] && children+=("$CHESS_LLAMA_DEV_GATEWAY_PID")
  [[ -n $CHESS_LLAMA_DEV_CLIENT_PID ]] && children+=("$CHESS_LLAMA_DEV_CLIENT_PID")
  local status=0
  if ((${#children[@]})); then
    chess_llama_info dev 'supervising managed services' count "${#children[@]}" \
      gatewayPid "${CHESS_LLAMA_DEV_GATEWAY_PID:-reused}" clientPid "${CHESS_LLAMA_DEV_CLIENT_PID:-reused}"
    if wait -n "${children[@]}"; then
      status=0
    else
      status=$?
    fi
    local -a exited=()
    [[ -n $CHESS_LLAMA_DEV_GATEWAY_PID ]] && ! kill -0 "$CHESS_LLAMA_DEV_GATEWAY_PID" 2>/dev/null && exited+=(gateway)
    [[ -n $CHESS_LLAMA_DEV_CLIENT_PID ]] && ! kill -0 "$CHESS_LLAMA_DEV_CLIENT_PID" 2>/dev/null && exited+=(client)
    local exited_services=${exited[*]:-unknown}
    CHESS_LLAMA_DEV_SHUTDOWN_REASON="managed service exited: $exited_services"
    if ((status == 0)); then
      chess_llama_warn dev 'managed service exited' service "$exited_services" exitCode "$status"
    else
      chess_llama_error dev 'managed service exited' service "$exited_services" exitCode "$status"
    fi
  else
    chess_llama_info dev 'all services are pre-existing; waiting for a signal'
    while :; do sleep 3600; done
  fi
  chess_llama_dev_cleanup
  trap - EXIT INT TERM
  return "$status"
}
