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
  chess_llama_debug doctor 'running check' check "$name" required "$required"
  chess_llama_debug_command doctor "$@"
  if detail=$("$@" 2>&1); then
    chess_llama_doctor_add "$name" true "${detail:-ok}" "$required"
  else
    chess_llama_doctor_add "$name" false "${detail:-command failed}" "$required"
  fi
}

chess_llama_doctor_port() {
  local port=$1
  chess_llama_debug doctor 'checking port' port "$port"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"; then
    chess_llama_doctor_add "port:$port" false 'in use' false
  else
    chess_llama_doctor_add "port:$port" true available false
  fi
}

chess_llama_doctor_pnpm_version() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const match = /^pnpm@(.+)$/.exec(manifest.packageManager ?? "");
    if (match?.[1] === undefined) process.exit(1);
    process.stdout.write(match[1]);
  ' "$CHESS_LLAMA_PROJECT_ROOT/package.json"
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

chess_llama_doctor_human_report() {
  local report=$1
  # JavaScript template expressions are intentional in the single-quoted source.
  # shellcheck disable=SC2016
  printf '%s' "$report" | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const report = JSON.parse(source);

    const colorEnabled = Boolean(
      process.stdout.isTTY &&
      process.env.TERM !== "dumb" &&
      process.env.NO_COLOR === undefined
    );
    const paint = (code, value) => colorEnabled ? `\u001b[${code}m${value}\u001b[0m` : value;
    const normalize = (value) => String(value)
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const truncate = (value, limit = 100) => {
      const normalized = normalize(value);
      const codePoints = Array.from(normalized);
      return codePoints.length <= limit
        ? normalized
        : `${codePoints.slice(0, limit - 3).join("")}...`;
    };
    const labels = new Map([
      ["bash", "Bash"],
      ["node", "Node.js"],
      ["pnpm", "pnpm"],
      ["docker", "Docker"],
      ["compose", "Docker Compose"],
      ["curl", "curl"],
      ["flock", "flock"],
      ["script", "script"],
      ["setsid", "setsid"],
      ["sha256sum", "sha256sum"],
      ["ss", "ss"],
      ["nvidia", "NVIDIA container GPU"],
      ["xdg:config", "Config directory"],
      ["xdg:database", "Database directory"],
      ["xdg:backups", "Backup directory"],
      ["xdg:benchmarks", "Benchmark directory"],
      ["xdg:models", "Model directory"],
      ["migration", "Database migration"],
      ["model-installed", "Model weights"],
      ["model-health", "Model health"],
      ["backend-health", "Backend health"],
    ]);
    const labelFor = (check) => check.name.startsWith("port:")
      ? `Port ${check.name.slice("port:".length)}`
      : labels.get(check.name) ?? check.name;
    const markerFor = (check) => {
      if (check.ok) return paint("32", "[OK]  ");
      return check.requiredForDev ? paint("31", "[FAIL]") : paint("33", "[WARN]");
    };
    const detailFor = (check) => {
      if (check.name.startsWith("port:") && !check.ok) {
        return "in use; stop its owner if Chess Llama should bind this port";
      }
      return truncate(check.detail);
    };
    const remedyFor = (check) => {
      if (
        ["nvidia", "model-installed"].includes(check.name) &&
        normalize(check.detail).toLowerCase().includes("runtime manifest operation is unavailable")
      ) {
        return "Run pnpm build before checking the runtime or model.";
      }
      if (check.name === "pnpm") {
        const expected = /\(expected ([^)]+)\)$/.exec(normalize(check.detail))?.[1];
        return expected
          ? `Run corepack prepare pnpm@${expected} --activate.`
          : "Activate the pnpm version declared in package.json.";
      }
      const commandRemedies = new Map([
        ["bash", "Run Chess Llama with Bash 5 or newer."],
        ["node", "Install and activate Node.js 24."],
        ["docker", "Start Docker and ensure this user can access the Docker daemon."],
        ["compose", "Install or enable the Docker Compose plugin."],
        ["nvidia", "Verify the NVIDIA driver and Container Toolkit, then pull the pinned model image."],
        ["model-installed", "Run ./chess-llama model pull to install and verify the default model."],
      ]);
      if (commandRemedies.has(check.name)) return commandRemedies.get(check.name);
      if (["curl", "flock", "script", "setsid", "sha256sum", "ss"].includes(check.name)) {
        return `Install the ${check.name} command and ensure it is on PATH.`;
      }
      if (check.name.startsWith("xdg:")) {
        const path = normalize(check.detail).replace(/ is not writable$/, "");
        return `Make ${path} writable by the current user.`;
      }
      return `Resolve the reported ${labelFor(check)} failure and rerun doctor.`;
    };
    const renderSection = (title, checks) => {
      const lines = [title];
      for (const check of checks) {
        lines.push(`  ${markerFor(check)} ${labelFor(check).padEnd(20)} ${detailFor(check)}`);
      }
      return lines;
    };

    const required = report.checks.filter((check) => check.requiredForDev);
    const runtime = report.checks.filter((check) => !check.requiredForDev);
    const failures = required.filter((check) => !check.ok);
    const status = report.prerequisitesOk
      ? paint("32", "READY (all required checks passed)")
      : paint("31", `NOT READY (${failures.length} required ${failures.length === 1 ? "check" : "checks"} failed)`);
    const lines = [
      paint("1", "Chess Llama Doctor"),
      `Status: ${status}`,
      "",
      ...renderSection("Required for startup", required),
      "",
      ...renderSection("Runtime status", runtime),
    ];
    if (failures.length > 0) {
      lines.push("", "Next steps");
      failures.forEach((check, index) => {
        lines.push(truncate(`  ${index + 1}. ${labelFor(check)}: ${remedyFor(check)}`, 140));
      });
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  '
}

chess_llama_doctor_main() {
  if [[ ${1:-} == -h || ${1:-} == --help || ${1:-} == help ]]; then
    printf 'Usage: chess-llama doctor [--format json|human]\n\ncheck local prerequisites\n'
    return
  fi
  chess_llama_parse_format "$@" || return
  chess_llama_resolve_paths
  chess_llama_debug doctor 'resolved paths' database "$CHESS_LLAMA_DATABASE_FILE" models "$CHESS_LLAMA_MODEL_DIR" \
    backups "$CHESS_LLAMA_BACKUPS_DIR" benchmarks "$CHESS_LLAMA_BENCHMARKS_DIR" compose "$CHESS_LLAMA_COMPOSE_FILE"
  CHESS_LLAMA_DOCTOR_VALUES=()
  CHESS_LLAMA_DOCTOR_PREREQUISITES_OK=true

  local version expected_pnpm_version
  chess_llama_doctor_add bash "$([[ ${BASH_VERSINFO[0]} -ge 5 ]] && printf true || printf false)" "$BASH_VERSION" true
  if version=$(node --version 2>&1); then
    chess_llama_doctor_add node "$([[ $version == v24.* ]] && printf true || printf false)" "${version#v}" true
  else
    chess_llama_doctor_add node false "$version" true
  fi
  if expected_pnpm_version=$(chess_llama_doctor_pnpm_version 2>/dev/null); then
    if version=$(pnpm --version 2>&1); then
      if [[ $version == "$expected_pnpm_version" ]]; then
        chess_llama_doctor_add pnpm true "$version" true
      else
        chess_llama_doctor_add pnpm false "$version (expected $expected_pnpm_version)" true
      fi
    else
      chess_llama_doctor_add pnpm false "${version:-pnpm unavailable} (expected $expected_pnpm_version)" true
    fi
  else
    chess_llama_doctor_add pnpm false 'packageManager must declare pnpm@<version> in package.json' true
  fi
  chess_llama_doctor_command docker true docker info --format '{{.ServerVersion}}'
  chess_llama_doctor_command compose true docker compose version
  local tool
  for tool in curl flock script setsid sha256sum ss; do
    chess_llama_doctor_command "$tool" true command -v "$tool"
  done

  local image=''
  if image=$(chess_llama_runtime_image 2>/dev/null); then
    chess_llama_doctor_command nvidia true docker run --rm --pull never --gpus all --entrypoint nvidia-smi "$image" -L
  else
    chess_llama_doctor_add nvidia false 'Runtime manifest operation is unavailable' true
  fi

  local name directory
  while read -r name directory; do
    chess_llama_debug doctor 'checking path' name "$name" path "$directory"
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

  local database_entry=${CHESS_LLAMA_DATABASE_ENTRY:-$CHESS_LLAMA_PROJECT_ROOT/packages/operations/dist/database.js}
  local detail
  chess_llama_debug doctor 'checking migration state' entry "$database_entry" database "$CHESS_LLAMA_DATABASE_FILE"
  if [[ -f $database_entry ]] && detail=$(node "$database_entry" status 2>&1); then
    chess_llama_doctor_add migration "$([[ $detail == *'"pending":false'* ]] && printf true || printf false)" "$detail" false
  else
    chess_llama_doctor_add migration false "${detail:-Operations build is missing}" false
  fi

  local profile='' model_file='' expected='' actual=''
  chess_llama_debug doctor 'checking installed model' directory "$CHESS_LLAMA_MODEL_DIR"
  if ! profile=$(chess_llama_preferred_profile 2>/dev/null); then
    chess_llama_doctor_add model-installed false 'Runtime manifest operation is unavailable' true
  elif ! model_file=$(chess_llama_profile_field "$profile" file 2>/dev/null) ||
    ! expected=$(chess_llama_profile_field "$profile" sha256 2>/dev/null); then
    chess_llama_doctor_add model-installed false 'Selected model profile is unavailable' true
  elif [[ ! -f $CHESS_LLAMA_MODEL_DIR/$model_file || ! -r $CHESS_LLAMA_MODEL_DIR/$model_file ]]; then
    chess_llama_doctor_add model-installed false "Model file is not installed: $model_file" true
  else
    actual=$(sha256sum -- "$CHESS_LLAMA_MODEL_DIR/$model_file" | awk '{print $1}')
    if [[ $actual == "$expected" ]]; then
      chess_llama_doctor_add model-installed true "$model_file checksum verified" true
    else
      chess_llama_doctor_add model-installed false "Installed model checksum mismatch: $model_file" true
    fi
  fi

  chess_llama_debug doctor 'checking service health' service=model endpoint http://127.0.0.1:8080/v1/health
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:8080/v1/health >/dev/null 2>&1; then
    chess_llama_doctor_add model-health true 'HTTP 200' false
  else
    chess_llama_doctor_add model-health false 'health endpoint unavailable' false
  fi
  chess_llama_debug doctor 'checking service health' service=backend endpoint http://127.0.0.1:3001/api/health
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    chess_llama_doctor_add backend-health true 'HTTP 200' false
  else
    chess_llama_doctor_add backend-health false 'health endpoint unavailable' false
  fi

  local report
  report=$(chess_llama_doctor_report)
  if [[ $CHESS_LLAMA_FORMAT == human ]]; then
    chess_llama_doctor_human_report "$report"
  else
    printf '%s\n' "$report"
  fi
  if [[ $CHESS_LLAMA_DOCTOR_PREREQUISITES_OK != true ]]; then
    chess_llama_error doctor 'prerequisite checks failed' exitCode "$CHESS_LLAMA_EXIT_PREREQUISITE"
    return "$CHESS_LLAMA_EXIT_PREREQUISITE"
  fi
}
