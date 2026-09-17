#!/usr/bin/env bash

chess_llama_database_help() {
  cat <<'EOF'
Usage: chess-llama db [command]

manage the SQLite database

Commands:
  backup             create a timestamped SQLite backup
  migrate            apply pending migrations
  status             report migration status
EOF
}

chess_llama_database_main() {
  local command=${1:-}
  local entry=${CHESS_LLAMA_DATABASE_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/apps/operations/dist/database.js}
  case "$command" in
    '' | -h | --help | help)
      chess_llama_database_help
      return
      ;;
    backup | migrate | status) ;;
    *)
      chess_llama_input_error "Unknown db command: $command"
      return
      ;;
  esac
  shift
  chess_llama_resolve_paths
  chess_llama_require_operations_entry "$entry" || return
  case "$command" in
    migrate)
      (($# == 0)) || {
        chess_llama_input_error "Unknown option: $1"
        return
      }
      node "$entry" migrate >/dev/null || {
        printf 'Database migration failed\n' >&2
        return "$CHESS_LLAMA_EXIT_STORAGE"
      }
      ;;
    backup)
      (($# == 0)) || {
        chess_llama_input_error "Unknown option: $1"
        return
      }
      node "$entry" backup || {
        printf 'Database backup failed\n' >&2
        return "$CHESS_LLAMA_EXIT_STORAGE"
      }
      ;;
    status)
      chess_llama_parse_format "$@" || return
      local output
      output=$(node "$entry" status) || {
        printf 'Database status failed\n' >&2
        return "$CHESS_LLAMA_EXIT_STORAGE"
      }
      chess_llama_render_json "$CHESS_LLAMA_FORMAT" "$output"
      ;;
  esac
}
