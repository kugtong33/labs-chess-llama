#!/usr/bin/env bash

chess_llama_gateway_help() {
  cat <<'EOF'
Usage: chess-llama gateway [command]

manage the gateway

Commands:
  dev                run gateway TypeScript source with Node
  start              run the compiled gateway with Node
  health             query gateway health
EOF
}

chess_llama_gateway_environment() {
  chess_llama_resolve_paths
  export DATABASE_PATH=$CHESS_LLAMA_DATABASE_FILE
  export LLAMA_BASE_URL=http://127.0.0.1:8080
  export CLIENT_ORIGIN=http://127.0.0.1:5173
}

chess_llama_gateway_main() {
  local command=${1:-}
  case "$command" in
    '' | -h | --help | help)
      chess_llama_gateway_help
      ;;
    dev)
      chess_llama_gateway_environment
      chess_llama_run_in_project node --import tsx "$CHESS_LLAMA_PROJECT_ROOT/apps/gateway/src/main.ts" || {
        printf 'Gateway development server failed\n' >&2
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      ;;
    start)
      chess_llama_gateway_environment
      if [[ ! -f $CHESS_LLAMA_PROJECT_ROOT/apps/gateway/dist/main.js ]]; then
        printf 'Gateway build is missing; run pnpm build\n' >&2
        return "$CHESS_LLAMA_EXIT_PREREQUISITE"
      fi
      chess_llama_run_in_project node "$CHESS_LLAMA_PROJECT_ROOT/apps/gateway/dist/main.js" || {
        printf 'Gateway start failed\n' >&2
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      ;;
    health)
      shift
      chess_llama_parse_format "$@" || return
      local output
      output=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3001/api/health) || {
        printf 'Gateway health check failed\n' >&2
        return "$CHESS_LLAMA_EXIT_HEALTH"
      }
      chess_llama_render_json "$CHESS_LLAMA_FORMAT" "$output"
      ;;
    *) chess_llama_input_error "Unknown gateway command: $command" ;;
  esac
}
