import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  backupDatabase,
  createSettingsRepository,
  getMigrationStatus,
  migrateDatabase,
  openDatabase,
} from '@chess-llama/storage';

export type DatabaseOperation =
  'backup' | 'migrate' | 'preferred-profile' | 'status';

export interface DatabaseOperationOptions {
  databaseFile: string;
  backupsDir?: string;
  now?: () => number;
}

export async function runDatabaseOperation(
  operation: DatabaseOperation,
  options: DatabaseOperationOptions,
): Promise<unknown> {
  await mkdir(dirname(options.databaseFile), { recursive: true });
  const database = openDatabase(options.databaseFile);
  try {
    switch (operation) {
      case 'migrate':
        migrateDatabase(database);
        return { migrated: true };
      case 'status':
        return getMigrationStatus(database);
      case 'preferred-profile':
        return {
          profileId: createSettingsRepository(database).get().modelProfileId,
        };
      case 'backup': {
        if (!options.backupsDir)
          throw new Error('Backups directory is required');
        await mkdir(options.backupsDir, { recursive: true });
        const destination = join(
          options.backupsDir,
          `chess-llama-${(options.now ?? Date.now)()}.sqlite`,
        );
        await backupDatabase(database, destination);
        return { path: destination };
      }
    }
  } finally {
    database.close();
  }
}

async function main(): Promise<void> {
  const operation = process.argv[2] as DatabaseOperation | undefined;
  if (
    !operation ||
    !['backup', 'migrate', 'preferred-profile', 'status'].includes(operation)
  ) {
    throw new Error(`Unknown database operation: ${operation ?? ''}`);
  }
  const databaseFile = process.env.CHESS_LLAMA_DATABASE_FILE;
  if (!databaseFile) throw new Error('CHESS_LLAMA_DATABASE_FILE is required');
  const value = await runDatabaseOperation(operation, {
    databaseFile,
    backupsDir: process.env.CHESS_LLAMA_BACKUPS_DIR,
  });
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
