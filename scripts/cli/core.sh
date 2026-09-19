#!/usr/bin/env bash

readonly CHESS_LLAMA_EXIT_UNEXPECTED=1
readonly CHESS_LLAMA_EXIT_INPUT=2
readonly CHESS_LLAMA_EXIT_PREREQUISITE=3
readonly CHESS_LLAMA_EXIT_RUNTIME=4
readonly CHESS_LLAMA_EXIT_HEALTH=5
readonly CHESS_LLAMA_EXIT_STORAGE=6

# shellcheck source=scripts/cli/paths.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/paths.sh"
# shellcheck source=scripts/cli/output.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/output.sh"
# shellcheck source=scripts/cli/web.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/web.sh"
# shellcheck source=scripts/cli/database.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/database.sh"
# shellcheck source=scripts/cli/backend.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/backend.sh"
# shellcheck source=scripts/cli/logs.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/logs.sh"
# shellcheck source=scripts/cli/model.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/model.sh"
# shellcheck source=scripts/cli/doctor.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/doctor.sh"
# shellcheck source=scripts/cli/dev.sh
source "$CHESS_LLAMA_PROJECT_ROOT/scripts/cli/dev.sh"

chess_llama_help() {
  cat <<'EOF'
Usage: chess-llama [options] [command]

local hybrid chess backend and runtime

Commands:
  backend            manage the backend
  db                 manage the SQLite database
  dev                start the local development stack
  doctor             check local prerequisites
  logs               follow curated decision traces
  model              manage the local model
  web                manage the browser web application
  help [command]     display help for command

Options:
  -h, --help         display help for command
  --verbose          show subprocess commands and probe details
EOF
}

chess_llama_input_error() {
  chess_llama_error cli "$1"
  return "$CHESS_LLAMA_EXIT_INPUT"
}

chess_llama_main() {
  while (($#)); do
    case "$1" in
      --)
        shift
        ;;
      --verbose)
        CHESS_LLAMA_LOG_LEVEL=debug
        export CHESS_LLAMA_LOG_LEVEL
        shift
        ;;
      *) break ;;
    esac
  done
  if [[ $CHESS_LLAMA_LOG_LEVEL != info && $CHESS_LLAMA_LOG_LEVEL != debug ]]; then
    local invalid_log_level=$CHESS_LLAMA_LOG_LEVEL
    CHESS_LLAMA_LOG_LEVEL=info
    chess_llama_input_error "Unsupported CHESS_LLAMA_LOG_LEVEL: $invalid_log_level"
    return
  fi

  local command=${1:-}
  chess_llama_debug cli dispatch command "${command:-help}"
  case "$command" in
    '' | -h | --help)
      chess_llama_help
      ;;
    help)
      shift
      if (($# == 0)); then
        chess_llama_help
      else
        local namespace=$1
        chess_llama_main "$namespace" --help
      fi
      ;;
    web)
      shift
      chess_llama_web_main "$@"
      ;;
    backend)
      shift
      chess_llama_backend_main "$@"
      ;;
    logs)
      shift
      chess_llama_logs_main "$@"
      ;;
    db)
      shift
      chess_llama_database_main "$@"
      ;;
    model)
      shift
      chess_llama_model_main "$@"
      ;;
    doctor)
      shift
      chess_llama_doctor_main "$@"
      ;;
    dev)
      shift
      chess_llama_dev_main "$@"
      ;;
    *)
      chess_llama_input_error "Unknown command: $command"
      ;;
  esac
}
