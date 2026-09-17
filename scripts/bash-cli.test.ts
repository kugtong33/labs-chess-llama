import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const executable = resolve(projectRoot, 'chess-llama');
const nodeBin = dirname(process.execPath);

function runWithEnv(args: string[], environment: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', [executable, ...args], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CHESS_LLAMA_PROJECT_ROOT: projectRoot,
      ...environment,
    },
  });
}

function run(...args: string[]) {
  return runWithEnv(args);
}

function fakeTool(directory: string, name: string) {
  const path = join(directory, name);
  writeFileSync(
    path,
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$0 $*" >> "$CHESS_LLAMA_TEST_TRACE"\nprintf \'%s\\n\' "DATABASE_PATH=${DATABASE_PATH-}" >> "$CHESS_LLAMA_TEST_TRACE"\n',
  );
  chmodSync(path, 0o755);
}

function writeTool(directory: string, name: string, source: string) {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${source}\n`);
  chmodSync(path, 0o755);
}

describe('Bash CLI public contract', () => {
  it('exposes the complete command surface from the root executable', () => {
    const result = run('--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('local hybrid chess gateway and runtime');
    for (const command of [
      'client',
      'db',
      'dev',
      'doctor',
      'gateway',
      'model',
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  it('returns the stable input exit code for an unknown command', () => {
    const result = run('unknown');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown command: unknown');
  });

  it('accepts the leading separator forwarded by the pnpm wrapper', () => {
    const result = run('--', '--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: chess-llama');
  });

  it('routes namespaced help to the requested command', () => {
    const result = run('help', 'model');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: chess-llama model');
  });

  it('runs the client build through the Vite CLI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const trace = join(directory, 'trace');
    fakeTool(directory, 'pnpm');

    const result = runWithEnv(['client', 'build'], {
      PATH: `${directory}:/usr/bin:/bin`,
      CHESS_LLAMA_TEST_TRACE: trace,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(trace, 'utf8')).toContain(
      'pnpm --filter @chess-llama/client exec vite build',
    );
  });

  it('runs gateway development with Node and resolved application paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const trace = join(directory, 'trace');
    const database = join(directory, 'state', 'chess.sqlite');
    fakeTool(directory, 'node');

    const result = runWithEnv(['gateway', 'dev'], {
      PATH: `${directory}:/usr/bin:/bin`,
      CHESS_LLAMA_DATABASE_FILE: database,
      CHESS_LLAMA_TEST_TRACE: trace,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(trace, 'utf8')).toContain(
      `node --import tsx ${projectRoot}/apps/gateway/src/main.ts`,
    );
    expect(readFileSync(trace, 'utf8')).toContain(`DATABASE_PATH=${database}`);
  });

  it('queries gateway health with curl and preserves JSON output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    writeTool(directory, 'curl', 'printf \'{"status":"ok"}\\n\'');

    const result = runWithEnv(['gateway', 'health', '--format', 'json'], {
      PATH: `${directory}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"status":"ok"}\n');
  });

  it('reports a missing operations build as a prerequisite failure', () => {
    const result = runWithEnv(['db', 'status'], {
      CHESS_LLAMA_DATABASE_ENTRY: '/tmp/chess-llama-missing/database.js',
    });

    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain('Operations build is missing');
  });

  it('reports doctor checks as JSON and uses the prerequisite exit code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    writeTool(directory, 'pnpm', "printf '0.0.0\\n'");
    writeTool(
      directory,
      'docker',
      "printf 'docker unavailable\\n' >&2; exit 1",
    );

    const result = runWithEnv(['doctor', '--format', 'json'], {
      PATH: `${directory}:${nodeBin}:/usr/bin:/bin`,
      HOME: directory,
      XDG_CONFIG_HOME: join(directory, 'config'),
      XDG_DATA_HOME: join(directory, 'data'),
      XDG_CACHE_HOME: join(directory, 'cache'),
    });

    expect(result.status, result.stderr).toBe(3);
    expect(result.stdout).toContain('"prerequisitesOk":false');
    expect(result.stdout).toContain('"name":"node","ok":true');
    expect(result.stdout).toContain('"name":"pnpm","ok":false');
    expect(result.stdout).toContain('"name":"docker","ok":false');
  });

  it('stops dev before startup when prerequisites fail', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    writeTool(directory, 'pnpm', "printf '0.0.0\\n'");
    writeTool(directory, 'docker', 'exit 1');

    const result = runWithEnv(['dev'], {
      PATH: `${directory}:${nodeBin}:/usr/bin:/bin`,
      HOME: directory,
      XDG_CONFIG_HOME: join(directory, 'config'),
      XDG_DATA_HOME: join(directory, 'data'),
      XDG_CACHE_HOME: join(directory, 'cache'),
    });

    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
  });

  it('isolates dev children and terminates their process groups in reverse order', () => {
    const devSource = readFileSync(
      join(projectRoot, 'scripts/cli/dev.sh'),
      'utf8',
    );

    expect(devSource).toContain(
      'setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" gateway start &',
    );
    expect(devSource).toContain(
      'setsid --wait "$CHESS_LLAMA_PROJECT_ROOT/chess-llama" client dev &',
    );
    expect(devSource.indexOf('"$CHESS_LLAMA_DEV_CLIENT_PID"')).toBeLessThan(
      devSource.indexOf('"$CHESS_LLAMA_DEV_GATEWAY_PID"'),
    );
    expect(devSource).toContain('kill -TERM -- "-$pid"');
  });

  it('maps an unknown model profile to the stable input exit code', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const runtimeEntry = join(directory, 'runtime.js');
    writeFileSync(runtimeEntry, 'placeholder');
    writeTool(
      directory,
      'node',
      "printf 'Unknown model profile: missing\\n' >&2; exit 1",
    );

    const result = runWithEnv(['model', 'pull', '--profile', 'missing'], {
      PATH: `${directory}:/usr/bin:/bin`,
      CHESS_LLAMA_RUNTIME_ENTRY: runtimeEntry,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown model profile: missing');
  });

  it('downloads model weights through curl and installs only a verified file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const runtimeEntry = join(directory, 'runtime.js');
    const modelDir = join(directory, 'models');
    const trace = join(directory, 'trace');
    const bytes = 'verified model';
    const checksum = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(runtimeEntry, 'placeholder');
    writeTool(
      directory,
      'node',
      `case "$2" in
  profile) printf '{}\\n' ;;
  image) printf 'example.invalid/llama@sha256:${'a'.repeat(64)}\\n' ;;
  profile-field)
    case "$4" in
      file) printf 'model.gguf\\n' ;;
      sha256) printf '${checksum}\\n' ;;
      url) printf 'https://example.invalid/model.gguf\\n' ;;
    esac
    ;;
esac`,
    );
    writeTool(
      directory,
      'docker',
      'printf \'%s\\n\' "$*" >> "$CHESS_LLAMA_TEST_TRACE"',
    );
    writeTool(
      directory,
      'curl',
      `while (($#)); do
  if [[ $1 == --output ]]; then shift; destination=$1; fi
  shift
done
printf '${bytes}' > "$destination"`,
    );

    const result = runWithEnv(['model', 'pull', '--profile', 'test-profile'], {
      PATH: `${directory}:/usr/bin:/bin`,
      CHESS_LLAMA_MODEL_DIR: modelDir,
      CHESS_LLAMA_RUNTIME_ENTRY: runtimeEntry,
      CHESS_LLAMA_TEST_TRACE: trace,
      XDG_RUNTIME_DIR: join(directory, 'run'),
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(modelDir, 'model.gguf'), 'utf8')).toBe(bytes);
    expect(readFileSync(trace, 'utf8')).toContain('compose -f');
  });

  it('rejects a healthy llama.cpp server carrying the wrong model', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const runtimeEntry = join(directory, 'runtime.js');
    const modelDir = join(directory, 'models');
    const bytes = 'verified model';
    const checksum = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(runtimeEntry, 'placeholder');
    writeFileSync(join(directory, 'model.gguf'), bytes);
    writeTool(
      directory,
      'node',
      `case "$2" in
  profile) printf '{}\\n' ;;
  image) printf 'example.invalid/llama@sha256:${'a'.repeat(64)}\\n' ;;
  profile-field)
    case "$4" in
      file) printf 'model.gguf\\n' ;;
      sha256) printf '${checksum}\\n' ;;
    esac
    ;;
  *) ${process.execPath} "$@" ;;
esac`,
    );
    writeTool(directory, 'docker', 'exit 0');
    writeTool(
      directory,
      'curl',
      'case "${*: -1}" in */v1/models) printf \'{"data":[{"id":"other.gguf"}]}\\n\' ;; *) printf \'{"status":"ok"}\\n\' ;; esac',
    );
    spawnSync('mkdir', ['-p', modelDir]);
    writeFileSync(join(modelDir, 'model.gguf'), bytes);

    const result = runWithEnv(['model', 'start', '--profile', 'test-profile'], {
      PATH: `${directory}:/usr/bin:/bin`,
      CHESS_LLAMA_MODEL_DIR: modelDir,
      CHESS_LLAMA_RUNTIME_ENTRY: runtimeEntry,
      XDG_RUNTIME_DIR: join(directory, 'run'),
    });

    expect(result.status).toBe(5);
    expect(result.stderr).toContain('loaded other.gguf, expected model.gguf');
  });

  it('stops llama.cpp through Docker Compose', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const trace = join(directory, 'trace');
    writeTool(
      directory,
      'docker',
      'printf \'%s\\n\' "$0 $*" >> "$CHESS_LLAMA_TEST_TRACE"',
    );

    const result = runWithEnv(['model', 'stop'], {
      PATH: `${directory}:/usr/bin:/bin`,
      CHESS_LLAMA_TEST_TRACE: trace,
      XDG_CACHE_HOME: join(directory, 'cache'),
    });

    expect(result.status).toBe(0);
    expect(readFileSync(trace, 'utf8')).toContain(
      `docker compose -f ${projectRoot}/infra/compose.yaml rm -s -f llama`,
    );
  });

  it('reports model logs with the established JSON result envelope', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    writeTool(
      directory,
      'docker',
      "printf 'llama ready\\n'; printf 'compose warning\\n' >&2",
    );

    const result = runWithEnv(['model', 'logs'], {
      PATH: `${directory}:${nodeBin}:/usr/bin:/bin`,
      XDG_CACHE_HOME: join(directory, 'cache'),
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      exitCode: 0,
      stdout: 'llama ready',
      stderr: 'compose warning',
    });
  });

  it('preserves a failing Docker Compose status from model logs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    writeTool(directory, 'docker', "printf 'logs failed\\n' >&2; exit 17");

    const result = runWithEnv(['model', 'logs'], {
      PATH: `${directory}:${nodeBin}:/usr/bin:/bin`,
      XDG_CACHE_HOME: join(directory, 'cache'),
    });

    expect(result.status).toBe(17);
    expect(JSON.parse(result.stdout)).toEqual({
      exitCode: 17,
      stdout: '',
      stderr: 'logs failed',
    });
  });

  it('passes repeatable benchmark profiles to the Node domain operation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chess-llama-cli-'));
    const trace = join(directory, 'trace');
    const benchmarkEntry = join(directory, 'benchmark.js');
    writeFileSync(benchmarkEntry, 'placeholder');
    writeTool(
      directory,
      'node',
      'printf \'%s\\n\' "$0 $*" >> "$CHESS_LLAMA_TEST_TRACE"; printf \'%s\\n\' \'{"qualified":true,"profiles":[],"status":"PASS"}\'',
    );

    const result = runWithEnv(
      [
        'model',
        'benchmark',
        '--profile',
        'small',
        '--profile',
        'credible',
        '--format',
        'json',
      ],
      {
        PATH: `${directory}:/usr/bin:/bin`,
        CHESS_LLAMA_BENCHMARK_ENTRY: benchmarkEntry,
        CHESS_LLAMA_TEST_TRACE: trace,
        XDG_CACHE_HOME: join(directory, 'cache'),
        XDG_DATA_HOME: join(directory, 'data'),
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(trace, 'utf8')).toContain(
      `node ${benchmarkEntry} run small credible`,
    );
    expect(result.stdout).toContain('"qualified":true');
  });
});
