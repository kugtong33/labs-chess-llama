import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];
const entrypoint = resolve(import.meta.dirname, 'entrypoint.sh');

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chess-llama-entrypoint-'));
  fixtures.push(root);
  const modelDirectory = join(root, 'models');
  const manifestPath = join(root, 'runtime-manifest.json');
  const model = Buffer.from('cached model');
  await writeFile(
    manifestPath,
    JSON.stringify({
      profiles: [
        {
          id: 'test-profile',
          url: 'https://models.example.test/model.gguf',
          sha256: createHash('sha256').update(model).digest('hex'),
        },
      ],
    }),
  );
  return { root, modelDirectory, manifestPath, model };
}

async function run(
  environment: Record<string, string>,
  command: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'chess-llama-command-'));
  fixtures.push(directory);
  const stdoutPath = join(directory, 'stdout');
  const stderrPath = join(directory, 'stderr');
  const stdout = await open(stdoutPath, 'w');
  const stderr = await open(stderrPath, 'w');
  try {
    const result = spawnSync(entrypoint, command, {
      env: environment,
      stdio: ['ignore', stdout.fd, stderr.fd],
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    return {
      code: result.status,
      stdout: await readFile(stdoutPath, 'utf8'),
      stderr: await readFile(stderrPath, 'utf8'),
    };
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }
}

describe('llama entrypoint', () => {
  it('refuses to start the server when model bootstrap fails', async () => {
    const value = await fixture();
    const result = await run(
      {
        PATH: process.env.PATH ?? '',
        LLAMA_PROFILE_ID: 'missing',
        LLAMA_MANIFEST_PATH: value.manifestPath,
        LLAMA_MODEL_DIRECTORY: value.modelDirectory,
      },
      [process.execPath, '--eval', "process.stdout.write('server started\\n')"],
    );

    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('server started');
    expect(result.stderr).toContain('Unknown model profile: missing');
  });

  it('starts the supplied server command after reusing a valid model', async () => {
    const value = await fixture();
    await mkdir(value.modelDirectory, { recursive: true });
    await writeFile(join(value.modelDirectory, 'current.gguf'), value.model);
    const result = await run(
      {
        PATH: process.env.PATH ?? '',
        LLAMA_PROFILE_ID: 'test-profile',
        LLAMA_MANIFEST_PATH: value.manifestPath,
        LLAMA_MODEL_DIRECTORY: value.modelDirectory,
      },
      [process.execPath, '--eval', "process.stdout.write('server started\\n')"],
    );

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('Model reused:');
    expect(result.stdout).toContain('server started');
  });
});
