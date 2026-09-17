#!/usr/bin/env bash

CHESS_LLAMA_DEV_MODEL_OWNED=false
CHESS_LLAMA_DEV_GATEWAY_PID=''
CHESS_LLAMA_DEV_CLIENT_PID=''
CHESS_LLAMA_DEV_CLEANED=false

chess_llama_dev_cleanup() {
  if [[ $CHESS_LLAMA_DEV_CLEANED == true ]]; then
    return
  fi
  CHESS_LLAMA_DEV_CLEANED=true
  local pid
  for pid in "$CHESS_LLAMA_DEV_CLIENT_PID" "$CHESS_LLAMA_DEV_GATEWAY_PID"; do
    if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ $CHESS_LLAMA_DEV_MODEL_OWNED == true ]]; then
    chess_llama_model_stop >/dev/null 2>&1 || true
  fi
}

chess_llama_dev_signal() {
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
  if ! chess_llama_doctor_main --format json >/dev/null; then
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  fi

  chess_llama_database_main migrate || return $?

  CHESS_LLAMA_DEV_MODEL_OWNED=false
  CHESS_LLAMA_DEV_GATEWAY_PID=''
  CHESS_LLAMA_DEV_CLIENT_PID=''
  CHESS_LLAMA_DEV_CLEANED=false
  trap chess_llama_dev_signal INT TERM
  trap chess_llama_dev_cleanup EXIT

  local model_status=''
  model_status=$(chess_llama_model_status --format json 2>/dev/null) || true
  if [[ $model_status != *'"healthy":true'* ]]; then
    CHESS_LLAMA_DEV_MODEL_OWNED=true
    chess_llama_model_start || return $?
  fi

  if ! curl --fail --silent --show-error --max-time 1 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" gateway start &
    CHESS_LLAMA_DEV_GATEWAY_PID=$!
  fi

  if ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)5173$'; then
    setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" client dev &
    CHESS_LLAMA_DEV_CLIENT_PID=$!
  fi

  local -a children=()
  [[ -n $CHESS_LLAMA_DEV_GATEWAY_PID ]] && children+=("$CHESS_LLAMA_DEV_GATEWAY_PID")
  [[ -n $CHESS_LLAMA_DEV_CLIENT_PID ]] && children+=("$CHESS_LLAMA_DEV_CLIENT_PID")
  local status=0
  if ((${#children[@]})); then
    if wait -n "${children[@]}"; then
      status=0
    else
      status=$?
    fi
  else
    while :; do sleep 3600; done
  fi
  chess_llama_dev_cleanup
  trap - EXIT INT TERM
  return "$status"
}
