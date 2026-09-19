#!/usr/bin/env bash

chess_llama_web_help() {
  cat <<'EOF'
Usage: chess-llama web [command]

manage the browser web application

Commands:
  build              build the React web application with Vite
  dev                start the Vite development server
  serve              preview the production web build
EOF
}

chess_llama_web_main() {
  local command=${1:-}
  case "$command" in
    '' | -h | --help | help)
      chess_llama_web_help
      ;;
    build)
      chess_llama_info web 'building production web application' project "$CHESS_LLAMA_PROJECT_ROOT"
      chess_llama_debug_command web pnpm --filter @chess-llama/web exec vite build
      chess_llama_run_in_project pnpm --filter @chess-llama/web exec vite build || {
        local status=$?
        chess_llama_error web 'build failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok web 'build complete' output "$CHESS_LLAMA_PROJECT_ROOT/web/dist"
      ;;
    dev)
      chess_llama_info web 'starting development server' url http://127.0.0.1:5173 project "$CHESS_LLAMA_PROJECT_ROOT"
      chess_llama_debug_command web pnpm --filter @chess-llama/web exec vite --host 127.0.0.1
      chess_llama_run_in_project pnpm --filter @chess-llama/web exec vite --host 127.0.0.1 || {
        local status=$?
        chess_llama_error web 'development server failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok web 'development server stopped'
      ;;
    serve)
      chess_llama_info web 'starting production preview' url http://127.0.0.1:4173 project "$CHESS_LLAMA_PROJECT_ROOT"
      chess_llama_debug_command web pnpm --filter @chess-llama/web exec vite preview --host 127.0.0.1
      chess_llama_run_in_project pnpm --filter @chess-llama/web exec vite preview --host 127.0.0.1 || {
        local status=$?
        chess_llama_error web 'preview server failed' exitCode "$status"
        return "$CHESS_LLAMA_EXIT_RUNTIME"
      }
      chess_llama_ok web 'production preview stopped'
      ;;
    *) chess_llama_input_error "Unknown web command: $command" ;;
  esac
}
