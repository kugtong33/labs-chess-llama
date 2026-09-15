import type { Command } from 'commander';

import type { CliDependencies } from '../dependencies.js';
import { CliFailure, exitCodes, parseOutputFormat } from '../output.js';
import { outputFor } from '../program.js';

export function registerDoctorCommand(
  parent: Command,
  dependencies: CliDependencies,
): void {
  parent
    .command('doctor')
    .option('--format <format>', 'output format', 'json')
    .action(async (options: { format?: 'json' | 'human' }) => {
      const report = await dependencies.doctor(dependencies.signal);
      outputFor(dependencies).write(report, parseOutputFormat(options.format));
      if (!report.ok)
        throw new CliFailure(
          'Prerequisite checks failed',
          exitCodes.prerequisite,
        );
    });
}
