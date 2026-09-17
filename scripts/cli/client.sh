#!/usr/bin/env bash

chess_llama_client_help() {
  cat <<'EOF'
Usage: chess-llama client [command]

manage the browser client

Commands:
  build              build the React client with Vite
  dev                start the Vite development server
  serve              preview the production client build
EOF
}

chess_llama_client_main() {
  local command=${1:-}
  case "$command" in
    '' | -h | --help | help)
      chess_llama_client_help
      ;;
    build)
      chess_llama_info client 'building production client' project "$CHESS_LLAMA_PROJECT_ROOT"
      chess_llama_debug_command client pnpm --filter @chess-llama/client exec vite build
      chess_llama_run_in_project pnpm --filter @chess-llama/client exec vite build || {
        local status=$?
        chess_llama_error client 'build failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok client 'build complete' output "$CHESS_LLAMA_PROJECT_ROOT/apps/client/dist"
      ;;
    dev)
      chess_llama_info client 'starting development server' url http://127.0.0.1:5173 project "$CHESS_LLAMA_PROJECT_ROOT"
      chess_llama_debug_command client pnpm --filter @chess-llama/client exec vite --host 127.0.0.1
      chess_llama_run_in_project pnpm --filter @chess-llama/client exec vite --host 127.0.0.1 || {
        local status=$?
        chess_llama_error client 'development server failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok client 'development server stopped'
      ;;
    serve)
      chess_llama_info client 'starting production preview' url http://127.0.0.1:4173 project "$CHESS_LLAMA_PROJECT_ROOT"
      chess_llama_debug_command client pnpm --filter @chess-llama/client exec vite preview --host 127.0.0.1
      chess_llama_run_in_project pnpm --filter @chess-llama/client exec vite preview --host 127.0.0.1 || {
        local status=$?
        chess_llama_error client 'preview server failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok client 'production preview stopped'
      ;;
    *) chess_llama_input_error "Unknown client command: $command" ;;
  esac
}
