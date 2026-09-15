import { execa } from 'execa';

import type { DockerAdapter } from './types.js';

export class DockerCliAdapter implements DockerAdapter {
  public async compose(
    args: readonly string[],
    env: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) {
    const composeFile = env.CHESS_LLAMA_COMPOSE_FILE;
    if (!composeFile) throw new Error('CHESS_LLAMA_COMPOSE_FILE is required');
    const result = await execa(
      'docker',
      ['compose', '-f', composeFile, ...args],
      { env, reject: false, cancelSignal: signal },
    );
    return {
      exitCode: result.exitCode ?? 1,
      stdout: String(result.stdout),
      stderr: String(result.stderr),
    };
  }
}
