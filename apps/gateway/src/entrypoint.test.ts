import { execFile, spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const gatewayRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(gatewayRoot, '../..');
let fixtureRoot: string;
let builtDirectory: string;

async function runEntry(arguments_: string[], input = '') {
  const directory = await mkdtemp(join(fixtureRoot, 'invocation-'));
  await writeFile(join(directory, 'stdin'), input);
  const stdin = await open(join(directory, 'stdin'), 'r');
  const stdout = await open(join(directory, 'stdout'), 'w');
  const stderr = await open(join(directory, 'stderr'), 'w');
  try {
    // File descriptors also capture Node diagnostics in restricted sandboxes
    // where asynchronous child-process pipe writes can be unavailable.
    const result = spawnSync(process.execPath, arguments_, {
      cwd: gatewayRoot,
      env: { PATH: process.env.PATH },
      stdio: [stdin.fd, stdout.fd, stderr.fd],
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    return {
      code: result.status,
      stdout: await readFile(join(directory, 'stdout'), 'utf8'),
      stderr: await readFile(join(directory, 'stderr'), 'utf8'),
    };
  } finally {
    await Promise.all([stdin.close(), stdout.close(), stderr.close()]);
  }
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(
    join(tmpdir(), 'chess-llama-gateway-entrypoint-'),
  );
  builtDirectory = join(fixtureRoot, 'releases/build');
  await mkdir(builtDirectory, { recursive: true });
  await writeFile(join(fixtureRoot, 'package.json'), '{"type":"module"}');
  await symlink(
    join(gatewayRoot, 'node_modules'),
    join(fixtureRoot, 'node_modules'),
  );
  await symlink(import.meta.dirname, join(fixtureRoot, 'source-current'));
  await symlink('releases/build', join(fixtureRoot, 'current'));
  await executeFile(
    process.execPath,
    [
      join(repositoryRoot, 'node_modules/tsup/dist/cli-default.js'),
      'src/main.ts',
      '--format',
      'esm',
      '--out-dir',
      builtDirectory,
    ],
    { cwd: gatewayRoot },
  );
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe.each(['source', 'built'] as const)('%s gateway entrypoint', (kind) => {
  function paths() {
    return kind === 'source'
      ? {
          direct: join(import.meta.dirname, 'main.ts'),
          linked: join(fixtureRoot, 'source-current/main.ts'),
          loader: ['--import', 'tsx'],
        }
      : {
          direct: join(builtDirectory, 'main.js'),
          linked: join(fixtureRoot, 'current/main.js'),
          loader: [],
        };
  }

  it.each(['direct', 'linked'] as const)(
    'starts config validation when invoked through %s path',
    async (mode) => {
      const entrypoint = paths();
      // Missing required config proves startGateway ran without opening a server.
      const result = await runEntry([...entrypoint.loader, entrypoint[mode]]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/ZodError:[\s\S]*databasePath/u);
    },
  );

  it('can be imported through a symlink without starting the gateway', async () => {
    const entrypoint = paths();
    const result = await runEntry([
      ...entrypoint.loader,
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(entrypoint.linked).href)})`,
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });

  it.each(['stdin', 'missing-file'] as const)(
    'can be imported from %s without resolving an executable path',
    async (mode) => {
      const entrypoint = paths();
      const script = [
        mode === 'missing-file'
          ? `process.argv[1] = ${JSON.stringify(join(fixtureRoot, 'missing.js'))};`
          : '',
        `await import(${JSON.stringify(pathToFileURL(entrypoint.linked).href)});`,
        `process.stdout.write('imported\\n');`,
      ].join('\n');
      const result = await runEntry(
        [
          ...entrypoint.loader,
          '--input-type=module',
          ...(mode === 'stdin' ? ['-'] : ['--eval', script]),
        ],
        mode === 'stdin' ? script : '',
      );
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe('imported\n');
      expect(result.stderr).toBe('');
    },
  );
});
