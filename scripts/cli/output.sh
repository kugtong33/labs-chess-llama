#!/usr/bin/env bash

chess_llama_parse_format() {
  CHESS_LLAMA_FORMAT=json
  while (($#)); do
    case "$1" in
      --format)
        shift
        (($#)) || {
          chess_llama_input_error 'Option --format requires a value'
          return
        }
        CHESS_LLAMA_FORMAT=$1
        ;;
      *)
        chess_llama_input_error "Unknown option: $1"
        return
        ;;
    esac
    shift
  done
  if [[ $CHESS_LLAMA_FORMAT != json && $CHESS_LLAMA_FORMAT != human ]]; then
    chess_llama_input_error "Unsupported output format: $CHESS_LLAMA_FORMAT"
    return
  fi
}

chess_llama_render_json() {
  local format=$1
  local source=${2:-}
  if [[ $format == json ]]; then
    printf '%s\n' "$source"
    return
  fi
  # JavaScript template expressions are intentional in the single-quoted source.
  # shellcheck disable=SC2016
  CHESS_LLAMA_JSON=$source node --input-type=module -e '
    const value = JSON.parse(process.env.CHESS_LLAMA_JSON);
    const display = (item) => typeof item === "object" && item !== null ? JSON.stringify(item) : String(item);
    const renderRows = (rows) => {
      if (!rows.length) return "";
      const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      const widths = keys.map((key) => Math.max(key.length, ...rows.map((row) => display(row[key]).length)));
      const render = (row) => keys.map((key, index) => display(row[key]).padEnd(widths[index])).join("  ").trimEnd();
      return [render(Object.fromEntries(keys.map((key) => [key, key]))), ...rows.map(render)].join("\n");
    };
    if (value && typeof value === "object" && Array.isArray(value.checks)) {
      const summary = Object.entries(value).filter(([key]) => key !== "checks").map(([key, item]) => `${key.padEnd(18)} ${display(item)}`);
      process.stdout.write(`${[...summary, renderRows(value.checks)].filter(Boolean).join("\n")}\n`);
    } else if (Array.isArray(value)) {
      process.stdout.write(`${renderRows(value)}\n`);
    } else if (value && typeof value === "object") {
      process.stdout.write(`${Object.entries(value).map(([key, item]) => `${key.padEnd(18)} ${display(item)}`).join("\n")}\n`);
    } else {
      process.stdout.write(`${display(value)}\n`);
    }
  '
}

chess_llama_require_operations_entry() {
  local entry=$1
  if [[ ! -f $entry ]]; then
    printf 'Operations build is missing; run pnpm build\n' >&2
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  fi
}
