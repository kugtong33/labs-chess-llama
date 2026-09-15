import type { Command } from 'commander';

import type { CliDependencies } from '../dependencies.js';
import { asCliFailure, exitCodes, parseOutputFormat } from '../output.js';
import { outputFor } from '../program.js';

export function registerDatabaseCommands(
  parent: Command,
  dependencies: CliDependencies,
): void {
  const database = parent
    .command('db')
    .description('manage the SQLite database');
  database.command('backup').action(async () => {
    outputFor(dependencies).write({
      path: await asCliFailure(
        dependencies.database.backup(),
        exitCodes.storage,
        'Database backup failed',
      ),
    });
  });
  database.command('migrate').action(async () => {
    await asCliFailure(
      dependencies.database.migrate(),
      exitCodes.storage,
      'Database migration failed',
    );
  });
  database
    .command('status')
    .option('--format <format>', 'output format', 'json')
    .action(async (options: { format?: 'json' | 'human' }) => {
      outputFor(dependencies).write(
        await asCliFailure(
          dependencies.database.status(),
          exitCodes.storage,
          'Database status failed',
        ),
        parseOutputFormat(options.format),
      );
    });
}
