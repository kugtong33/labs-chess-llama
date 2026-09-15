import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getMigrationStatus,
  migrateDatabase,
  openDatabase,
  type SqliteDatabase,
} from './database.js';
import { createGameRepository } from './game-repository.js';
import { createSettingsRepository } from './settings-repository.js';

export interface StorageHarness {
  readonly path: string;
  readonly db: SqliteDatabase;
  games: ReturnType<typeof createGameRepository>;
  settings: ReturnType<typeof createSettingsRepository>;
  close(): void;
  closeAndReopen(): void;
}

export function createTestStorage(existingPath?: string): StorageHarness {
  const directory =
    existingPath === undefined
      ? mkdtempSync(join(tmpdir(), 'chess-llama-storage-'))
      : undefined;
  const path = existingPath ?? join(directory as string, 'storage.sqlite');
  let db = openDatabase(path);
  migrateDatabase(db);
  let games = createGameRepository(db);
  let settings = createSettingsRepository(db);
  let closed = false;

  const harness: StorageHarness = {
    path,
    get db() {
      return db;
    },
    get games() {
      return games;
    },
    set games(value) {
      games = value;
    },
    get settings() {
      return settings;
    },
    set settings(value) {
      settings = value;
    },
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
      if (directory !== undefined) {
        rmSync(directory, { recursive: true, force: true });
      } else {
        rmSync(path, { force: true });
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
      }
    },
    closeAndReopen() {
      if (!closed) db.close();
      db = openDatabase(path);
      migrateDatabase(db);
      games = createGameRepository(db);
      settings = createSettingsRepository(db);
      closed = false;
    },
  };

  return harness;
}

export { getMigrationStatus };
