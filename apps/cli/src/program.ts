import { Command } from 'commander';

import { registerClientCommands } from './commands/client.js';
import { registerDatabaseCommands } from './commands/database.js';
import { devDependencies, runDev } from './commands/dev.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerGatewayCommands } from './commands/gateway.js';
import { registerModelCommands } from './commands/model.js';
import type { CliDependencies, Output } from './dependencies.js';
import { createOutput, exitCodeFor, PassthroughExit } from './output.js';

export type { CliDependencies } from './dependencies.js';

export function outputFor(dependencies: CliDependencies): Output {
  return dependencies.output ?? createOutput();
}

export function buildProgram(dependencies: CliDependencies): Command {
  const program = new Command('chess-llama')
    .description('local hybrid chess gateway and runtime')
    .exitOverride();
  registerClientCommands(program, dependencies);
  registerDatabaseCommands(program, dependencies);
  program
    .command('dev')
    .description('start the local development stack')
    .action(async () => {
      const exitCode = await runDev(devDependencies(dependencies));
      if (exitCode !== 0)
        throw new PassthroughExit('development stack stopped', exitCode);
    });
  registerDoctorCommand(program, dependencies);
  registerGatewayCommands(program, dependencies);
  registerModelCommands(program, dependencies);
  return program;
}

export function commandPaths(program: Command): string[] {
  const result: string[] = [];
  const visit = (command: Command, parent: string[]) => {
    for (const child of command.commands) {
      const path = [...parent, child.name()];
      if (child.commands.length === 0) result.push(path.join(' '));
      else visit(child, path);
    }
  };
  visit(program, []);
  return result;
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies,
  signal = dependencies.signal,
): Promise<number> {
  const scoped =
    signal === dependencies.signal ? dependencies : { ...dependencies, signal };
  const program = buildProgram(scoped);
  try {
    await program.parseAsync(['node', 'chess-llama', ...argv], {
      from: 'node',
    });
    return 0;
  } catch (error: unknown) {
    if (isHelpDisplayed(error)) return 0;
    outputFor(scoped).error(error);
    return exitCodeFor(error);
  }
}

function isHelpDisplayed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'commander.helpDisplayed'
  );
}
