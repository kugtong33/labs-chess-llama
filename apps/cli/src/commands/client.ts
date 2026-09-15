import type { Command } from 'commander';

import type { CliDependencies } from '../dependencies.js';
import { asCliFailure, exitCodes } from '../output.js';

export function registerClientCommands(
  parent: Command,
  dependencies: CliDependencies,
): void {
  const client = parent
    .command('client')
    .description('manage the browser client');
  client.command('build').action(async () => {
    await asCliFailure(
      dependencies.client.build(),
      exitCodes.runtime,
      'Client build failed',
    );
  });
  client.command('dev').action(async () => {
    await asCliFailure(
      dependencies.client.dev(dependencies.signal),
      exitCodes.runtime,
      'Client development server failed',
    );
  });
  client.command('serve').action(async () => {
    await asCliFailure(
      dependencies.client.serve(dependencies.signal),
      exitCodes.runtime,
      'Client preview server failed',
    );
  });
}
