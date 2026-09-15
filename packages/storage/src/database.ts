import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import Database from 'better-sqlite3';

const MIGRATION_ID = '0000_initial';
const MIGRATION_FILE = new URL('../drizzle/0000_initial.sql', import.meta.url);

export type SqliteDatabase = Database.Database;

export function openDatabase(path: string): SqliteDatabase {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function migrateDatabase(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);

  const alreadyApplied = db
    .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
    .get(MIGRATION_ID);
  if (alreadyApplied !== undefined) return;

  const migration = readFileSync(MIGRATION_FILE, 'utf8');
  const apply = db.transaction(() => {
    db.exec(migration);
    db.prepare(
      'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
    ).run(MIGRATION_ID, Date.now());
  });
  apply();
}

export interface MigrationStatus {
  current: string | null;
  expected: string;
  pending: boolean;
}

export function getMigrationStatus(db: SqliteDatabase): MigrationStatus {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (table === undefined) {
    return { current: null, expected: MIGRATION_ID, pending: true };
  }

  const row = db
    .prepare(
      'SELECT id FROM schema_migrations ORDER BY applied_at DESC LIMIT 1',
    )
    .get() as { id?: string } | undefined;
  const current = row?.id ?? null;
  return { current, expected: MIGRATION_ID, pending: current !== MIGRATION_ID };
}

export async function backupDatabase(
  db: SqliteDatabase,
  destination: string,
): Promise<void> {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${randomUUID()}.tmp`,
  );

  try {
    await db.backup(temporary);
    const { rename } = await import('node:fs/promises');
    await rename(temporary, destination);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(temporary, { force: true });
    throw error;
  }
}
