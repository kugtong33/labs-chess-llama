#!/usr/bin/env bash

chess_llama_backend_help() {
  cat <<'EOF'
Usage: chess-llama backend [command]

manage the backend

Commands:
  dev                run backend TypeScript source with Node
  start              run the compiled backend with Node
  health             query backend health
EOF
}

chess_llama_backend_environment() {
  chess_llama_resolve_paths
  export DATABASE_PATH=$CHESS_LLAMA_DATABASE_FILE
  export LLAMA_BASE_URL=http://127.0.0.1:8080
}

chess_llama_backend_main() {
  local command=${1:-}
  case "$command" in
    '' | -h | --help | help)
      chess_llama_backend_help
      ;;
    dev)
      chess_llama_backend_environment
      chess_llama_info backend 'starting development server' \
        entry "$CHESS_LLAMA_PROJECT_ROOT/backend/src/main.ts" \
        database "$DATABASE_PATH" llamaUrl "$LLAMA_BASE_URL" \
        url http://127.0.0.1:3001
      chess_llama_debug_command backend node --import tsx "$CHESS_LLAMA_PROJECT_ROOT/backend/src/main.ts"
      chess_llama_run_in_project node --import tsx "$CHESS_LLAMA_PROJECT_ROOT/backend/src/main.ts" || {
        local status=$?
        chess_llama_error backend 'development server failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok backend 'development server stopped'
      ;;
    start)
      chess_llama_backend_environment
      local entry=$CHESS_LLAMA_PROJECT_ROOT/backend/dist/main.js
      if [[ ! -f $entry ]]; then
        chess_llama_error backend 'compiled entrypoint is missing; run pnpm build' entry "$entry"
        return "$CHESS_LLAMA_EXIT_PREREQUISITE"
      fi
      chess_llama_info backend 'starting compiled server' entry "$entry" database "$DATABASE_PATH" \
        llamaUrl "$LLAMA_BASE_URL" url http://127.0.0.1:3001
      chess_llama_debug_command backend node "$entry"
      chess_llama_run_in_project node "$entry" || {
        local status=$?
        chess_llama_error backend 'compiled server failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok backend 'compiled server stopped'
      ;;
    health)
      shift
      chess_llama_parse_format "$@" || return
      local output
      chess_llama_debug backend 'checking health' endpoint http://127.0.0.1:3001/api/health
      chess_llama_debug_command backend curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3001/api/health
      output=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3001/api/health) || {
        local status=$?
        chess_llama_error backend 'health check failed' endpoint http://127.0.0.1:3001/api/health exitCode "$status"
        return "$CHESS_LLAMA_EXIT_HEALTH"
      }
      chess_llama_render_json "$CHESS_LLAMA_FORMAT" "$output"
      ;;
    *) chess_llama_input_error "Unknown backend command: $command" ;;
  esac
}
