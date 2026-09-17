#!/usr/bin/env bash

declare -a CHESS_LLAMA_DOCTOR_VALUES=()
CHESS_LLAMA_DOCTOR_PREREQUISITES_OK=true

chess_llama_doctor_add() {
  local name=$1 ok=$2 detail=$3 required=${4:-true}
  CHESS_LLAMA_DOCTOR_VALUES+=("$name" "$ok" "$required" "$detail")
  if [[ $required == true && $ok != true ]]; then
    CHESS_LLAMA_DOCTOR_PREREQUISITES_OK=false
  fi
}

chess_llama_doctor_command() {
  local name=$1 required=$2
  shift 2
  local detail
  if detail=$("$@" 2>&1); then
    chess_llama_doctor_add "$name" true "${detail:-ok}" "$required"
  else
    chess_llama_doctor_add "$name" false "${detail:-command failed}" "$required"
  fi
}

chess_llama_doctor_port() {
  local port=$1
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"; then
    chess_llama_doctor_add "port:$port" false 'in use' false
  else
    chess_llama_doctor_add "port:$port" true available false
  fi
}

chess_llama_doctor_report() {
  node --input-type=module -e '
    const values = process.argv.slice(1);
    const checks = [];
    for (let index = 0; index < values.length; index += 4) {
      checks.push({
        name: values[index],
        ok: values[index + 1] === "true",
        detail: values[index + 3],
        requiredForDev: values[index + 2] === "true",
      });
    }
    const prerequisitesOk = checks.filter((check) => check.requiredForDev).every((check) => check.ok);
    process.stdout.write(JSON.stringify({ ok: prerequisitesOk, prerequisitesOk, checks }));
  ' "${CHESS_LLAMA_DOCTOR_VALUES[@]}"
}

chess_llama_doctor_main() {
  if [[ ${1:-} == -h || ${1:-} == --help || ${1:-} == help ]]; then
    printf 'Usage: chess-llama doctor [--format json|human]\n\ncheck local prerequisites\n'
    return
  fi
  chess_llama_parse_format "$@" || return
  chess_llama_resolve_paths
  CHESS_LLAMA_DOCTOR_VALUES=()
  CHESS_LLAMA_DOCTOR_PREREQUISITES_OK=true

  local version
  chess_llama_doctor_add bash "$([[ ${BASH_VERSINFO[0]} -ge 5 ]] && printf true || printf false)" "$BASH_VERSION" true
  if version=$(node --version 2>&1); then
    chess_llama_doctor_add node "$([[ $version == v24.* ]] && printf true || printf false)" "${version#v}" true
  else
    chess_llama_doctor_add node false "$version" true
  fi
  if version=$(pnpm --version 2>&1); then
    chess_llama_doctor_add pnpm "$([[ $version == 11.5.1 ]] && printf true || printf false)" "$version" true
  else
    chess_llama_doctor_add pnpm false "$version" true
  fi
  chess_llama_doctor_command docker true docker info
  chess_llama_doctor_command compose true docker compose version
  local tool
  for tool in curl flock script setsid sha256sum ss; do
    chess_llama_doctor_command "$tool" true command -v "$tool"
  done

  local image=''
  if image=$(chess_llama_runtime_value image 2>/dev/null); then
    chess_llama_doctor_command nvidia true docker run --rm --pull never --gpus all --entrypoint nvidia-smi "$image" -L
  else
    chess_llama_doctor_add nvidia false 'Runtime manifest operation is unavailable' true
  fi

  local name directory
  while read -r name directory; do
    if mkdir -p -- "$directory" 2>/dev/null && [[ -w $directory ]]; then
      chess_llama_doctor_add "xdg:$name" true "$directory" true
    else
      chess_llama_doctor_add "xdg:$name" false "$directory is not writable" true
    fi
  done <<EOF
config ${CHESS_LLAMA_CONFIG_FILE%/*}
database ${CHESS_LLAMA_DATABASE_FILE%/*}
backups $CHESS_LLAMA_BACKUPS_DIR
benchmarks $CHESS_LLAMA_BENCHMARKS_DIR
models $CHESS_LLAMA_MODEL_DIR
EOF

  chess_llama_doctor_port 5173
  chess_llama_doctor_port 3001
  chess_llama_doctor_port 8080

  local database_entry=${CHESS_LLAMA_DATABASE_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/apps/operations/dist/database.js}
  local detail
  if [[ -f $database_entry ]] && detail=$(node "$database_entry" status 2>&1); then
    chess_llama_doctor_add migration "$([[ $detail == *'"pending":false'* ]] && printf true || printf false)" "$detail" false
  else
    chess_llama_doctor_add migration false "${detail:-Operations build is missing}" false
  fi

  local profile model_file expected actual
  if profile=$(chess_llama_preferred_profile 2>/dev/null) &&
    model_file=$(chess_llama_profile_field "$profile" file 2>/dev/null) &&
    expected=$(chess_llama_profile_field "$profile" sha256 2>/dev/null) &&
    [[ -f $CHESS_LLAMA_MODEL_DIR/$model_file && -r $CHESS_LLAMA_MODEL_DIR/$model_file ]]; then
    actual=$(sha256sum -- "$CHESS_LLAMA_MODEL_DIR/$model_file" | awk '{print $1}')
    if [[ $actual == "$expected" ]]; then
      chess_llama_doctor_add model-installed true "$model_file checksum verified" true
    else
      chess_llama_doctor_add model-installed false "Installed model checksum mismatch: $model_file" true
    fi
  else
    chess_llama_doctor_add model-installed false 'Selected model is not installed or runtime manifest is unavailable' true
  fi

  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:8080/v1/health >/dev/null 2>&1; then
    chess_llama_doctor_add model-health true 'HTTP 200' false
  else
    chess_llama_doctor_add model-health false 'health endpoint unavailable' false
  fi
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    chess_llama_doctor_add gateway-health true 'HTTP 200' false
  else
    chess_llama_doctor_add gateway-health false 'health endpoint unavailable' false
  fi

  local report
  report=$(chess_llama_doctor_report)
  chess_llama_render_json "$CHESS_LLAMA_FORMAT" "$report"
  if [[ $CHESS_LLAMA_DOCTOR_PREREQUISITES_OK != true ]]; then
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  fi
}
