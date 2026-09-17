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
      chess_llama_run_in_project pnpm --filter @chess-llama/client exec vite build || {
        printf 'Client build failed\n' >&2
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      ;;
    dev)
      chess_llama_run_in_project pnpm --filter @chess-llama/client exec vite --host 127.0.0.1 || {
        printf 'Client development server failed\n' >&2
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      ;;
    serve)
      chess_llama_run_in_project pnpm --filter @chess-llama/client exec vite preview --host 127.0.0.1 || {
        printf 'Client preview server failed\n' >&2
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      ;;
    *) chess_llama_input_error "Unknown client command: $command" ;;
  esac
}
