import type { Command } from 'commander';

import type { CliDependencies } from '../dependencies.js';
import {
  asCliFailure,
  CliFailure,
  exitCodes,
  parseOutputFormat,
  PassthroughExit,
} from '../output.js';
import { outputFor } from '../program.js';

async function profile(
  options: { profile?: string },
  dependencies: CliDependencies,
): Promise<string> {
  if (options.profile) return options.profile;
  let persisted: string | undefined;
  try {
    persisted = await dependencies.preferredProfile?.();
  } catch {
    persisted = undefined;
  }
  return persisted ?? dependencies.defaultProfile ?? 'qwen3-4b-q4-k-m';
}

export function registerModelCommands(
  parent: Command,
  dependencies: CliDependencies,
): void {
  const model = parent.command('model').description('manage the local model');
  model.command('logs').action(async () => {
    const result = await dependencies.model.logs();
    if (hasFailedExit(result)) {
      throw new PassthroughExit('Model logs command failed', result.exitCode);
    }
    outputFor(dependencies).write(result);
  });
  model
    .command('pull')
    .option('--profile <id>')
    .action(async (options: { profile?: string }) => {
      await dependencies.model.pull(
        await profile(options, dependencies),
        dependencies.signal,
      );
    });
  model
    .command('start')
    .option('--profile <id>')
    .action(async (options: { profile?: string }) => {
      try {
        await dependencies.model.start(
          await profile(options, dependencies),
          dependencies.signal,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        throw new CliFailure(
          'Model runtime start failed',
          /health|\/v1\/models|loaded .* expected/iu.test(message)
            ? exitCodes.health
            : exitCodes.runtime,
          { cause: error },
        );
      }
    });
  model
    .command('status')
    .option('--format <format>', 'output format', 'json')
    .action(async (options: { format?: 'json' | 'human' }) => {
      outputFor(dependencies).write(
        await asCliFailure(
          dependencies.model.status(),
          exitCodes.health,
          'Model status failed',
        ),
        parseOutputFormat(options.format),
      );
    });
  model.command('stop').action(async () => {
    await dependencies.model.stop();
  });
}

function hasFailedExit(value: unknown): value is { exitCode: number } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number' &&
    value.exitCode !== 0
  );
}
