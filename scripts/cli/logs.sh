#!/usr/bin/env bash

CHESS_LLAMA_LOGS_CURL_PID=''
CHESS_LLAMA_LOGS_FORMATTER_PID=''
CHESS_LLAMA_LOGS_INTERRUPTED=false

chess_llama_logs_help() {
  cat <<'EOF'
Usage: chess-llama logs follow [options]

follow curated decision traces from the gateway

Options:
  --layer LAYER     client, gateway, stockfish, llama, storage, or all (default: all)
  --game UUID       follow one game
  --format FORMAT   human or json (default: human)
EOF
}

chess_llama_logs_cleanup() {
  local pid
  for pid in "$CHESS_LLAMA_LOGS_CURL_PID" "$CHESS_LLAMA_LOGS_FORMATTER_PID"; do
    if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
}

chess_llama_logs_signal() {
  CHESS_LLAMA_LOGS_INTERRUPTED=true
  chess_llama_logs_cleanup
}

chess_llama_trace_stream_entry() {
  printf '%s\n' "${CHESS_LLAMA_TRACE_STREAM_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/apps/operations/dist/trace-stream.js}"
}

chess_llama_logs_parse_follow_options() {
  CHESS_LLAMA_LOGS_LAYER=all
  CHESS_LLAMA_LOGS_GAME=''
  CHESS_LLAMA_LOGS_FORMAT=human
  while (($#)); do
    case "$1" in
      --layer)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --layer requires a value'
          return
        }
        CHESS_LLAMA_LOGS_LAYER=$1
        ;;
      --game)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --game requires a UUID'
          return
        }
        CHESS_LLAMA_LOGS_GAME=$1
        if [[ ! $CHESS_LLAMA_LOGS_GAME =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]]; then
          chess_llama_input_error 'Option --game requires a UUID'
          return
        fi
        ;;
      --format)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --format requires a value'
          return
        }
        CHESS_LLAMA_LOGS_FORMAT=$1
        ;;
      *)
        chess_llama_input_error "Unknown option: $1"
        return
        ;;
    esac
    shift
  done
  case "$CHESS_LLAMA_LOGS_LAYER" in
    client | gateway | stockfish | llama | storage | all) ;;
    *)
      chess_llama_input_error "Unsupported trace layer: $CHESS_LLAMA_LOGS_LAYER"
      return
      ;;
  esac
  if [[ $CHESS_LLAMA_LOGS_FORMAT != human && $CHESS_LLAMA_LOGS_FORMAT != json ]]; then
    chess_llama_input_error "Unsupported output format: $CHESS_LLAMA_LOGS_FORMAT"
    return
  fi
}

chess_llama_logs_follow() {
  chess_llama_logs_parse_follow_options "$@" || return
  local entry
  entry=$(chess_llama_trace_stream_entry)
  chess_llama_require_operations_entry "$entry" logs || return

  local endpoint=http://127.0.0.1:3001/api/demo/events separator='?'
  if [[ $CHESS_LLAMA_LOGS_LAYER != all ]]; then
    endpoint+="${separator}layer=$CHESS_LLAMA_LOGS_LAYER"
    separator='&'
  fi
  if [[ -n $CHESS_LLAMA_LOGS_GAME ]]; then
    endpoint+="${separator}gameId=$CHESS_LLAMA_LOGS_GAME"
  fi

  CHESS_LLAMA_LOGS_CURL_PID=''
  CHESS_LLAMA_LOGS_FORMATTER_PID=''
  CHESS_LLAMA_LOGS_INTERRUPTED=false
  trap chess_llama_logs_signal INT TERM
  chess_llama_info logs 'following decision traces' endpoint "$endpoint" layer "$CHESS_LLAMA_LOGS_LAYER" \
    game "${CHESS_LLAMA_LOGS_GAME:-all}" format "$CHESS_LLAMA_LOGS_FORMAT"
  chess_llama_debug_command logs curl --fail --silent --show-error --no-buffer "$endpoint"
  chess_llama_debug_command logs node "$entry" --format "$CHESS_LLAMA_LOGS_FORMAT"

  # Keep the coprocess alive until its PID and pipe descriptors are captured.
  # Bash otherwise clears them as soon as a fast curl process exits.
  coproc CHESS_LLAMA_TRACE_CURL {
    IFS= read -r || exit
    exec curl --fail --silent --show-error --no-buffer "$endpoint"
  }
  local curl_pid=$CHESS_LLAMA_TRACE_CURL_PID
  local curl_fd=${CHESS_LLAMA_TRACE_CURL[0]}
  local start_fd=${CHESS_LLAMA_TRACE_CURL[1]}
  CHESS_LLAMA_LOGS_CURL_PID=$curl_pid
  # Duplicate the coprocess descriptor before starting an asynchronous reader.
  local stream_fd
  exec {stream_fd}<&"$curl_fd"
  node "$entry" --format "$CHESS_LLAMA_LOGS_FORMAT" <&"$stream_fd" &
  CHESS_LLAMA_LOGS_FORMATTER_PID=$!
  exec {stream_fd}<&-
  printf '\n' >&"$start_fd"
  exec {start_fd}>&-
  local formatter_status curl_status
  if wait "$CHESS_LLAMA_LOGS_FORMATTER_PID"; then
    formatter_status=0
  else
    formatter_status=$?
  fi
  if ((formatter_status != 0)); then
    chess_llama_logs_cleanup
  fi
  if wait "$curl_pid"; then
    curl_status=0
  else
    curl_status=$?
  fi
  CHESS_LLAMA_LOGS_CURL_PID=''
  if [[ $CHESS_LLAMA_LOGS_INTERRUPTED == true ]]; then
    wait "$CHESS_LLAMA_LOGS_FORMATTER_PID" 2>/dev/null || true
  fi
  CHESS_LLAMA_LOGS_FORMATTER_PID=''
  trap - INT TERM

  if [[ $CHESS_LLAMA_LOGS_INTERRUPTED == true ]]; then
    chess_llama_info logs 'trace follower interrupted'
    return 130
  fi
  if ((formatter_status != 0)); then
    chess_llama_error logs 'trace formatter failed' entry "$entry" exitCode "$formatter_status"
    return "$formatter_status"
  fi
  if ((curl_status != 0)); then
    chess_llama_error logs 'trace stream connection failed' endpoint "$endpoint" exitCode "$curl_status"
    return "$CHESS_LLAMA_EXIT_HEALTH"
  fi
}

chess_llama_logs_main() {
  local command=${1:-}
  case "$command" in
    '' | -h | --help | help) chess_llama_logs_help ;;
    follow)
      shift
      chess_llama_logs_follow "$@"
      ;;
    *) chess_llama_input_error "Unknown logs command: $command" ;;
  esac
}
