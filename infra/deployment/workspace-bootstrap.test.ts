import { execFile } from 'node:child_process';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapWorkspace } from './workspace-bootstrap.mjs';

const fixtures: string[] = [];
const executeFile = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createFixture(options: { packageManager?: string } = {}) {
  const root = await mkdtemp(
    join(tmpdir(), 'chess-llama-workspace-bootstrap-'),
  );
  fixtures.push(root);
  const sourceDirectory = join(root, 'source');
  const workspaceDirectory = join(root, 'workspace');
  const databaseDirectory = join(root, 'data', 'sqlite');
  const packageManager = options.packageManager ?? 'pnpm@12.4.2';

  await writeSourceFile(
    sourceDirectory,
    'package.json',
    JSON.stringify({ private: true, packageManager }),
  );
  await writeSourceFile(
    sourceDirectory,
    'pnpm-lock.yaml',
    'lockfileVersion: 9',
  );
  await writeSourceFile(
    sourceDirectory,
    'pnpm-workspace.yaml',
    'packages:\n  - apps/*\n  - packages/*\n',
  );
  await writeSourceFile(sourceDirectory, 'tsconfig.base.json', '{}');
  await writeSourceFile(sourceDirectory, 'tsconfig.json', '{}');
  await writeSourceFile(
    sourceDirectory,
    'apps/gateway/package.json',
    '{"name":"gateway"}',
  );
  await writeSourceFile(
    sourceDirectory,
    'apps/gateway/src/main.ts',
    'export {};',
  );
  await writeSourceFile(
    sourceDirectory,
    'apps/client/package.json',
    '{"name":"client"}',
  );
  await writeSourceFile(
    sourceDirectory,
    'apps/client/vite.config.ts',
    'export default {};',
  );
  await writeSourceFile(
    sourceDirectory,
    'packages/contracts/package.json',
    '{"name":"contracts"}',
  );
  await writeSourceFile(
    sourceDirectory,
    'packages/contracts/src/index.ts',
    'export {};',
  );

  return {
    sourceDirectory,
    workspaceDirectory,
    databaseDirectory,
    environment: {
      SOURCE_DIRECTORY: sourceDirectory,
      WORKSPACE_DIRECTORY: workspaceDirectory,
      DATABASE_DIRECTORY: databaseDirectory,
    },
  };
}

async function writeSourceFile(
  root: string,
  relativePath: string,
  content: string,
) {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

function successfulRunner() {
  return async (
    command: string,
    arguments_: string[],
    options: { cwd: string },
  ) => {
    if (
      command === 'corepack' &&
      arguments_[0] === 'enable' &&
      arguments_[1] === '--install-directory' &&
      arguments_[3] === 'pnpm'
    ) {
      return;
    }
    if (
      command === 'corepack' &&
      arguments_.join(' ') === 'pnpm install --frozen-lockfile'
    ) {
      return;
    }
    if (command === 'corepack' && arguments_.join(' ') === 'pnpm run build') {
      await writeSourceFile(
        options.cwd,
        'apps/gateway/dist/main.js',
        'built gateway',
      );
      return;
    }
    throw new Error(`Unexpected command: ${command} ${arguments_.join(' ')}`);
  };
}

describe('application workspace bootstrap', () => {
  it('makes pnpm available to child build scripts when only Corepack is on PATH', async () => {
    const fixture = await createFixture();
    const binDirectory = join(fixture.sourceDirectory, 'fixture-bin');
    await mkdir(binDirectory);
    await symlink(process.execPath, join(binDirectory, 'node'));
    // Model the public image's Corepack boundary without package downloads.
    // The build runs in a real shell whose PATH initially has no pnpm shim.
    await writeFile(
      join(binDirectory, 'corepack'),
      `#!/usr/bin/env node
const { readFileSync, writeFileSync, symlinkSync } = require('node:fs');
const { basename, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (basename(process.argv[1]) === 'pnpm') args.unshift('pnpm');
if (args[0] === 'enable' && args[1] === '--install-directory' && args[3] === 'pnpm') {
  symlinkSync(process.argv[1], join(args[2], 'pnpm'));
} else if (args.join(' ') === 'pnpm install --frozen-lockfile') {
  // The fixture has no dependencies to install.
} else if (args.join(' ') === 'pnpm run build') {
  const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts.build;
  const result = spawnSync('/bin/sh', ['-c', script], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (args.join(' ') === 'pnpm -r build') {
  writeFileSync('built.txt', 'child pnpm ran');
} else {
  throw new Error('Unexpected Corepack invocation: ' + args.join(' '));
}
`,
      { mode: 0o755 },
    );
    await writeSourceFile(
      fixture.sourceDirectory,
      'package.json',
      JSON.stringify({
        private: true,
        packageManager: 'pnpm@12.4.2',
        scripts: { build: 'pnpm -r build' },
      }),
    );

    const result = await executeFile(
      process.execPath,
      [join(import.meta.dirname, 'workspace-bootstrap.mjs')],
      { env: { ...fixture.environment, PATH: binDirectory } },
    );

    expect(result.stderr).toBe('');
    await expect(
      readFile(join(fixture.workspaceDirectory, 'current/built.txt'), 'utf8'),
    ).resolves.toBe('child pnpm ran');
  });

  it('copies the deployment allowlist while excluding local artifacts', async () => {
    const fixture = await createFixture();
    await writeSourceFile(
      fixture.sourceDirectory,
      '.git/config',
      'local git metadata',
    );
    await writeSourceFile(
      fixture.sourceDirectory,
      'node_modules/leak.js',
      'dependency',
    );
    await writeSourceFile(
      fixture.sourceDirectory,
      'apps/gateway/dist/stale.js',
      'stale build',
    );
    await writeSourceFile(
      fixture.sourceDirectory,
      'apps/gateway/node_modules/leak.js',
      'dependency',
    );
    await writeSourceFile(
      fixture.sourceDirectory,
      'packages/contracts/local.sqlite',
      'local state',
    );
    await writeSourceFile(
      fixture.sourceDirectory,
      'README.md',
      'not needed at runtime',
    );

    const result = await bootstrapWorkspace({
      environment: fixture.environment,
      runCommand: successfulRunner(),
    });

    await expect(
      access(join(result.releaseDirectory, 'package.json')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(result.releaseDirectory, 'pnpm-lock.yaml')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(result.releaseDirectory, 'apps/client/vite.config.ts')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(result.releaseDirectory, 'packages/contracts/src/index.ts')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(result.releaseDirectory, 'apps/gateway/dist/main.js')),
    ).resolves.toBeUndefined();
    await expect(
      access(join(result.releaseDirectory, '.git/config')),
    ).rejects.toThrow();
    await expect(
      access(join(result.releaseDirectory, 'node_modules/leak.js')),
    ).rejects.toThrow();
    await expect(
      access(
        join(result.releaseDirectory, 'apps/gateway/node_modules/leak.js'),
      ),
    ).rejects.toThrow();
    await expect(
      access(join(result.releaseDirectory, 'packages/contracts/local.sqlite')),
    ).rejects.toThrow();
    await expect(
      access(join(result.releaseDirectory, 'README.md')),
    ).rejects.toThrow();
  });

  it('requires an exact pnpm packageManager declaration before staging a release', async () => {
    const fixture = await createFixture({
      packageManager: 'pnpm@12.4.2 || pnpm@12.4.3',
    });

    await expect(
      bootstrapWorkspace({
        environment: fixture.environment,
        runCommand: () =>
          Promise.reject(
            new Error('package commands must not run for an invalid manifest'),
          ),
      }),
    ).rejects.toThrow('packageManager must be an exact pnpm version');

    await expect(
      access(join(fixture.workspaceDirectory, 'current')),
    ).rejects.toThrow();
  });

  it('builds a release, atomically selects it through current, cleans old releases, and prepares database access', async () => {
    const fixture = await createFixture();
    const oldRelease = join(
      fixture.workspaceDirectory,
      'releases',
      'old-release',
    );
    await mkdir(oldRelease, { recursive: true });
    await writeFile(join(oldRelease, 'marker'), 'old');
    await mkdir(fixture.workspaceDirectory, { recursive: true });
    await symlink(
      'releases/old-release',
      join(fixture.workspaceDirectory, 'current'),
    );

    const result = await bootstrapWorkspace({
      environment: fixture.environment,
      runCommand: successfulRunner(),
    });

    await expect(
      readlink(join(fixture.workspaceDirectory, 'current')),
    ).resolves.toBe(`releases/${result.sourceHash}`);
    expect(
      (
        await lstat(join(fixture.workspaceDirectory, 'current'))
      ).isSymbolicLink(),
    ).toBe(true);
    await expect(access(oldRelease)).rejects.toThrow();
    await expect(
      readdir(join(fixture.workspaceDirectory, 'releases')),
    ).resolves.toEqual([result.sourceHash]);
    expect((await stat(fixture.databaseDirectory)).mode & 0o777).toBe(0o777);
  });

  it('reuses the completed hash-named release when unchanged source is bootstrapped twice', async () => {
    const fixture = await createFixture();

    const first = await bootstrapWorkspace({
      environment: fixture.environment,
      runCommand: successfulRunner(),
    });
    const second = await bootstrapWorkspace({
      environment: fixture.environment,
      runCommand: successfulRunner(),
    });

    expect(second.sourceHash).toBe(first.sourceHash);
    await expect(
      readlink(join(fixture.workspaceDirectory, 'current')),
    ).resolves.toBe(`releases/${first.sourceHash}`);
    await expect(
      access(join(fixture.workspaceDirectory, 'releases', first.sourceHash)),
    ).resolves.toBeUndefined();
  });

  it('preserves the previous active release when the build fails', async () => {
    const fixture = await createFixture();
    const oldRelease = join(
      fixture.workspaceDirectory,
      'releases',
      'old-release',
    );
    await mkdir(oldRelease, { recursive: true });
    await writeFile(join(oldRelease, 'marker'), 'old');
    await mkdir(fixture.workspaceDirectory, { recursive: true });
    await symlink(
      'releases/old-release',
      join(fixture.workspaceDirectory, 'current'),
    );

    await expect(
      bootstrapWorkspace({
        environment: fixture.environment,
        runCommand: (command, arguments_) => {
          if (arguments_.join(' ') === 'pnpm run build') {
            return Promise.reject(new Error('build failed'));
          }
          if (command !== 'corepack') {
            return Promise.reject(new Error('unexpected executable'));
          }
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('build failed');

    await expect(
      readlink(join(fixture.workspaceDirectory, 'current')),
    ).resolves.toBe('releases/old-release');
    await expect(access(join(oldRelease, 'marker'))).resolves.toBeUndefined();
    await expect(
      readdir(join(fixture.workspaceDirectory, 'releases')),
    ).resolves.toEqual(['old-release']);
  });
});
