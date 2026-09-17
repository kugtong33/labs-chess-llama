import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDatabaseOperation } from './database.js';

describe('database operation entrypoint', () => {
  it('migrates and reports a persistent database', async () => {
    const databaseFile = join(
      mkdtempSync(join(tmpdir(), 'operations-db-')),
      'db.sqlite',
    );

    await runDatabaseOperation('migrate', { databaseFile });
    const status = await runDatabaseOperation('status', { databaseFile });

    expect(status).toMatchObject({ pending: false });
  });
});
