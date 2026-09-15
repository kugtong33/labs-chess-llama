import type { Command } from 'commander';

import type { CliDependencies } from '../dependencies.js';
import { asCliFailure, exitCodes, parseOutputFormat } from '../output.js';
import { outputFor } from '../program.js';

export function registerGatewayCommands(
  parent: Command,
  dependencies: CliDependencies,
): void {
  const gateway = parent.command('gateway').description('manage the gateway');
  gateway.command('dev').action(async () => {
    await dependencies.gateway.dev(dependencies.signal);
  });
  gateway
    .command('health')
    .option('--format <format>', 'output format', 'json')
    .action(async (options: { format?: 'json' | 'human' }) => {
      outputFor(dependencies).write(
        await asCliFailure(
          dependencies.gateway.health(dependencies.signal),
          exitCodes.health,
          'Gateway health check failed',
        ),
        parseOutputFormat(options.format),
      );
    });
  gateway.command('start').action(async () => {
    await dependencies.gateway.start(dependencies.signal);
  });
}
