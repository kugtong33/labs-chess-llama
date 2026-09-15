import type { Command } from 'commander';

import type { CliDependencies } from '../dependencies.js';

export function registerClientCommands(
  parent: Command,
  dependencies: CliDependencies,
): void {
  const client = parent
    .command('client')
    .description('manage the browser client');
  client.command('build').action(async () => {
    await dependencies.client.build();
  });
  client.command('dev').action(async () => {
    await dependencies.client.dev(dependencies.signal);
  });
  client.command('serve').action(async () => {
    await dependencies.client.serve(dependencies.signal);
  });
}
