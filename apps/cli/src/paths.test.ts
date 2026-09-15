import { describe, expect, it } from 'vitest';

import { resolveChessLlamaPaths } from './paths.js';

describe('resolveChessLlamaPaths', () => {
  it('uses the Linux and WSL-compatible XDG directory layout', () => {
    expect(
      resolveChessLlamaPaths(
        {
          XDG_CONFIG_HOME: '/xdg/config',
          XDG_DATA_HOME: '/xdg/data',
          XDG_CACHE_HOME: '/xdg/cache',
        },
        '/home/player',
        '/project',
      ),
    ).toEqual({
      configFile: '/xdg/config/chess-llama/config.json',
      databaseFile: '/xdg/data/chess-llama/chess-llama.sqlite',
      backupsDir: '/xdg/data/chess-llama/backups',
      benchmarksDir: '/xdg/data/chess-llama/benchmarks',
      modelDir: '/xdg/cache/chess-llama/models',
      composeFile: '/project/infra/compose.yaml',
    });
  });

  it('falls back to standard home directories and honors explicit overrides', () => {
    const paths = resolveChessLlamaPaths(
      {
        CHESS_LLAMA_DATABASE_FILE: '/state/game.sqlite',
        CHESS_LLAMA_MODEL_DIR: '/models',
      },
      '/home/player',
      '/project',
    );

    expect(paths).toMatchObject({
      configFile: '/home/player/.config/chess-llama/config.json',
      databaseFile: '/state/game.sqlite',
      backupsDir: '/home/player/.local/share/chess-llama/backups',
      benchmarksDir: '/home/player/.local/share/chess-llama/benchmarks',
      modelDir: '/models',
    });
  });

  it('ignores empty or relative XDG base directories', () => {
    const paths = resolveChessLlamaPaths(
      {
        XDG_CONFIG_HOME: '',
        XDG_DATA_HOME: 'relative-data',
        XDG_CACHE_HOME: './relative-cache',
      },
      '/home/player',
      '/project',
    );

    expect(paths).toMatchObject({
      configFile: '/home/player/.config/chess-llama/config.json',
      databaseFile: '/home/player/.local/share/chess-llama/chess-llama.sqlite',
      modelDir: '/home/player/.cache/chess-llama/models',
    });
  });
});
