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
  chess_llama_require_operations_entry "$entry" database || return
  case "$command" in
    migrate)
      (($# == 0)) || {
        chess_llama_input_error "Unknown option: $1"
        return
      }
      chess_llama_info database 'applying migrations' database "$CHESS_LLAMA_DATABASE_FILE"
      chess_llama_debug_command database node "$entry" migrate
      node "$entry" migrate >/dev/null || {
        local status=$?
        chess_llama_error database 'migration failed' database "$CHESS_LLAMA_DATABASE_FILE" exitCode "$status"
        return "$CHESS_LLAMA_EXIT_STORAGE"
      }
      chess_llama_ok database 'migrations complete' database "$CHESS_LLAMA_DATABASE_FILE"
      ;;
    backup)
      (($# == 0)) || {
        chess_llama_input_error "Unknown option: $1"
        return
      }
      chess_llama_info database 'creating backup' database "$CHESS_LLAMA_DATABASE_FILE" backups "$CHESS_LLAMA_BACKUPS_DIR"
      chess_llama_debug_command database node "$entry" backup
      local output destination
      output=$(node "$entry" backup) || {
        local status=$?
        chess_llama_error database 'backup failed' database "$CHESS_LLAMA_DATABASE_FILE" exitCode "$status"
        return "$CHESS_LLAMA_EXIT_STORAGE"
      }
      destination=$(printf '%s' "$output" | node --input-type=module -e '
        let source = "";
        for await (const chunk of process.stdin) source += chunk;
        process.stdout.write(JSON.parse(source).path ?? "");
      ') || destination=$CHESS_LLAMA_BACKUPS_DIR
      printf '%s\n' "$output"
      chess_llama_ok database 'backup complete' destination "$destination"
      ;;
    status)
      chess_llama_parse_format "$@" || return
      local output
      chess_llama_debug database 'checking migration status' database "$CHESS_LLAMA_DATABASE_FILE" entry "$entry"
      chess_llama_debug_command database node "$entry" status
      output=$(node "$entry" status) || {
        local status=$?
        chess_llama_error database 'status check failed' database "$CHESS_LLAMA_DATABASE_FILE" exitCode "$status"
        return "$CHESS_LLAMA_EXIT_STORAGE"
      }
      chess_llama_render_json "$CHESS_LLAMA_FORMAT" "$output"
      ;;
  esac
}
