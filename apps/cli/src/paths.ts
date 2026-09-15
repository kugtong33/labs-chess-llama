import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export interface ChessLlamaPaths {
  configFile: string;
  databaseFile: string;
  backupsDir: string;
  benchmarksDir: string;
  modelDir: string;
  composeFile: string;
}

export function resolveChessLlamaPaths(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  projectRoot = process.cwd(),
): ChessLlamaPaths {
  const configHome = absoluteOr(env.XDG_CONFIG_HOME, resolve(home, '.config'));
  const dataHome = absoluteOr(
    env.XDG_DATA_HOME,
    resolve(home, '.local', 'share'),
  );
  const cacheHome = absoluteOr(env.XDG_CACHE_HOME, resolve(home, '.cache'));
  const dataDir = resolve(dataHome, 'chess-llama');

  return {
    configFile: absoluteOr(
      env.CHESS_LLAMA_CONFIG_FILE,
      resolve(configHome, 'chess-llama', 'config.json'),
    ),
    databaseFile: absoluteOr(
      env.CHESS_LLAMA_DATABASE_FILE,
      resolve(dataDir, 'chess-llama.sqlite'),
    ),
    backupsDir: absoluteOr(
      env.CHESS_LLAMA_BACKUPS_DIR,
      resolve(dataDir, 'backups'),
    ),
    benchmarksDir: absoluteOr(
      env.CHESS_LLAMA_BENCHMARKS_DIR,
      resolve(dataDir, 'benchmarks'),
    ),
    modelDir: absoluteOr(
      env.CHESS_LLAMA_MODEL_DIR,
      resolve(cacheHome, 'chess-llama', 'models'),
    ),
    composeFile: absoluteOr(
      env.CHESS_LLAMA_COMPOSE_FILE,
      resolve(projectRoot, 'infra', 'compose.yaml'),
    ),
  };
}

function absoluteOr(value: string | undefined, fallback: string): string {
  return value && isAbsolute(value) ? value : fallback;
}
