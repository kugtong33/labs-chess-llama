#!/usr/bin/env bash

CHESS_LLAMA_LOG_LEVEL=${CHESS_LLAMA_LOG_LEVEL:-info}

chess_llama_log_value() {
  local value=${1:-} escaped
  if [[ $value == '<redacted>' || $value =~ ^[A-Za-z0-9_./:@%+=,-]+$ ]]; then
    printf '%s' "$value"
  else
    printf -v escaped '%q' "$value"
    printf '%s' "$escaped"
  fi
}

chess_llama_log() {
  local level=$1 component=$2 message=$3
  shift 3
  if [[ $level == debug && $CHESS_LLAMA_LOG_LEVEL != debug ]]; then
    return
  fi

  local marker color='' reset=''
  case "$level" in
    info) marker=INFO color=36 ;;
    ok) marker=OK color=32 ;;
    warn) marker=WARN color=33 ;;
    error) marker=ERROR color=31 ;;
    debug) marker=DEBUG color=35 ;;
    *) marker=${level^^} ;;
  esac
  if [[ -t 2 && ${TERM:-} != dumb && -z ${NO_COLOR+x} ]]; then
    color=$'\033['$color'm'
    reset=$'\033[0m'
  else
    color=''
  fi

  printf '%s[%s]%s %s: %s' "$color" "$marker" "$reset" "$component" "$message" >&2
  while (($# >= 2)); do
    printf ' %s=' "$1" >&2
    chess_llama_log_value "$2" >&2
    shift 2
  done
  printf '\n' >&2
}

chess_llama_info() { chess_llama_log info "$@"; }
chess_llama_ok() { chess_llama_log ok "$@"; }
chess_llama_warn() { chess_llama_log warn "$@"; }
chess_llama_error() { chess_llama_log error "$@"; }
chess_llama_debug() { chess_llama_log debug "$@"; }

chess_llama_sanitize_url() {
  local value=$1
  if [[ $value =~ ^([A-Za-z][A-Za-z0-9+.-]*://)([^/@]+@)?([^?#]+) ]]; then
    printf '%s%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}"
  else
    printf '%s' "$value"
  fi
}

chess_llama_debug_command() {
  local component=$1
  shift
  if [[ $CHESS_LLAMA_LOG_LEVEL != debug ]]; then
    return
  fi

  local rendered='' argument safe quoted redact_next=false lower assignment_name assignment_value
  for argument in "$@"; do
    lower=${argument,,}
    if [[ $redact_next == true ]]; then
      safe='<redacted>'
      redact_next=false
    elif [[ $lower =~ ^--(api-key|token|password|authorization)= ]]; then
      safe="${argument%%=*}=<redacted>"
    elif [[ $lower == --api-key || $lower == --token || $lower == --password || $lower == --authorization ]]; then
      safe=$argument
      redact_next=true
    elif [[ $argument =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      assignment_name=${argument%%=*}
      assignment_value=${argument#*=}
      if [[ ${assignment_name^^} =~ (TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION)$ ]]; then
        safe="$assignment_name=<redacted>"
      elif [[ $assignment_value == *://* ]]; then
        safe="$assignment_name=$(chess_llama_sanitize_url "$assignment_value")"
      else
        safe=$argument
      fi
    elif [[ $argument == *=* && ${argument#*=} == *://* ]]; then
      safe="${argument%%=*}=$(chess_llama_sanitize_url "${argument#*=}")"
    elif [[ $argument == *://* ]]; then
      safe=$(chess_llama_sanitize_url "$argument")
    else
      safe=$argument
    fi
    if [[ $safe == '<redacted>' || $safe == *'=<redacted>' ]]; then
      quoted=$safe
    else
      printf -v quoted '%q' "$safe"
    fi
    rendered+="${rendered:+ }$quoted"
  done
  chess_llama_debug "$component" "run $rendered"
}

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
    chess_llama_error "${2:-cli}" 'Operations build is missing; run pnpm build' entry "$entry"
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  fi
}
