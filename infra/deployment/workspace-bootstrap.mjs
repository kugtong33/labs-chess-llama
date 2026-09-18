import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
} from 'node:fs/promises';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const ROOT_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
]);
const SOURCE_DIRECTORIES = new Set(['apps', 'packages']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.pnpm',
  '.turbo',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
]);

/**
 * @typedef {{ absolutePath: string, relativePath: string }} SourceFile
 * @typedef {(command: string, arguments_: string[], options: { cwd: string, env: Record<string, string | undefined> }) => Promise<void>} CommandRunner
 */

/**
 * Builds an allowlisted source snapshot and atomically activates it for runtime services.
 *
 * @param {{ environment?: Record<string, string | undefined>, runCommand?: CommandRunner }} [options]
 * @returns {Promise<{ releaseDirectory: string, sourceHash: string }>}
 */
export async function bootstrapWorkspace({
  environment = process.env,
  runCommand = runProcess,
} = {}) {
  const sourceDirectory = requiredEnvironmentValue(
    environment,
    'SOURCE_DIRECTORY',
  );
  const workspaceDirectory = requiredEnvironmentValue(
    environment,
    'WORKSPACE_DIRECTORY',
  );
  const databaseDirectory = requiredEnvironmentValue(
    environment,
    'DATABASE_DIRECTORY',
  );
  const sourceFiles = await collectSourceFiles(sourceDirectory);
  const sourceHash = await hashSourceFiles(sourceFiles);
  const releasesDirectory = join(workspaceDirectory, 'releases');
  const releaseDirectory = join(releasesDirectory, sourceHash);
  const partialDirectory = join(
    releasesDirectory,
    `.${sourceHash}.partial-${randomUUID()}`,
  );

  await mkdir(releasesDirectory, { recursive: true });
  await prepareDatabaseDirectory(databaseDirectory);
  await mkdir(partialDirectory);

  try {
    await copySourceFiles(sourceFiles, partialDirectory);
    await readPackageManager(partialDirectory);
    const shimDirectory = join(workspaceDirectory, '.bin');
    await mkdir(shimDirectory, { recursive: true });
    const commandOptions = {
      cwd: partialDirectory,
      env: {
        ...process.env,
        ...environment,
        PATH: [shimDirectory, environment.PATH ?? process.env.PATH]
          .filter(Boolean)
          .join(delimiter),
      },
    };
    await runCommand(
      'corepack',
      ['enable', '--install-directory', shimDirectory, 'pnpm'],
      commandOptions,
    );
    await runCommand(
      'corepack',
      ['pnpm', 'install', '--frozen-lockfile'],
      commandOptions,
    );
    await runCommand('corepack', ['pnpm', 'run', 'build'], commandOptions);

    await promoteRelease(partialDirectory, releaseDirectory);
    await activateRelease(workspaceDirectory, sourceHash);
    await removeOldReleases(releasesDirectory, sourceHash);

    return { releaseDirectory, sourceHash };
  } catch (error) {
    await rm(partialDirectory, { recursive: true, force: true });
    throw error;
  }
}

/** @param {Record<string, string | undefined>} environment @param {string} name */
function requiredEnvironmentValue(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** @param {string} sourceDirectory */
async function collectSourceFiles(sourceDirectory) {
  /** @type {SourceFile[]} */
  const files = [];
  for (const name of [...ROOT_FILES].sort()) {
    const path = join(sourceDirectory, name);
    if (await isRegularFile(path)) {
      files.push({ absolutePath: path, relativePath: name });
    }
  }
  for (const name of [...SOURCE_DIRECTORIES].sort()) {
    await collectDirectoryFiles(
      sourceDirectory,
      join(sourceDirectory, name),
      files,
    );
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

/** @param {string} sourceDirectory @param {string} directory @param {SourceFile[]} files */
async function collectDirectoryFiles(sourceDirectory, directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await collectDirectoryFiles(sourceDirectory, path, files);
      }
    } else if (entry.isFile() && !isIgnoredFile(entry.name)) {
      files.push({
        absolutePath: path,
        relativePath: relative(sourceDirectory, path),
      });
    }
  }
}

/** @param {string} name */
function isIgnoredFile(name) {
  return (
    name === '.DS_Store' ||
    name === '.env' ||
    name.endsWith('.partial') ||
    name.endsWith('.tmp') ||
    /\.sqlite(?:-|$)/u.test(name)
  );
}

/** @param {string} path */
async function isRegularFile(path) {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** @param {unknown} error */
function isMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** @param {SourceFile[]} files */
async function hashSourceFiles(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(await readFile(file.absolutePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** @param {SourceFile[]} files @param {string} destinationDirectory */
async function copySourceFiles(files, destinationDirectory) {
  for (const file of files) {
    const destination = join(destinationDirectory, file.relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(file.absolutePath, destination);
  }
}

/** @param {string} directory */
async function readPackageManager(directory) {
  /** @type {unknown} */
  const manifest = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  );
  if (
    !isRecord(manifest) ||
    typeof manifest.packageManager !== 'string' ||
    !/^pnpm@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.packageManager)
  ) {
    throw new Error('packageManager must be an exact pnpm version');
  }
  return manifest.packageManager;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/** @param {string} databaseDirectory */
async function prepareDatabaseDirectory(databaseDirectory) {
  await mkdir(databaseDirectory, { recursive: true, mode: 0o777 });
  await chmod(databaseDirectory, 0o777);
}

/** @param {string} partialDirectory @param {string} releaseDirectory */
async function promoteRelease(partialDirectory, releaseDirectory) {
  try {
    await rename(partialDirectory, releaseDirectory);
  } catch (error) {
    if (!isExistingRelease(error)) {
      throw error;
    }
    await rm(partialDirectory, { recursive: true, force: true });
  }
}

/** @param {unknown} error */
function isExistingRelease(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
  );
}

/** @param {string} workspaceDirectory @param {string} releaseName */
async function activateRelease(workspaceDirectory, releaseName) {
  const partialCurrent = join(
    workspaceDirectory,
    `.current.partial-${randomUUID()}`,
  );
  await symlink(join('releases', releaseName), partialCurrent);
  try {
    const current = join(workspaceDirectory, 'current');
    await prepareActivationPath(current);
    await rename(partialCurrent, current);
  } catch (error) {
    await rm(partialCurrent, { force: true });
    throw error;
  }
}

/** @param {string} current */
async function prepareActivationPath(current) {
  let existing;
  try {
    existing = await lstat(current);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (existing.isDirectory()) {
    // Docker may have created an empty working directory before bootstrap ran.
    // rmdir refuses non-empty directories and never follows symlinks.
    await rmdir(current);
    return;
  }
  if (existing.isSymbolicLink()) {
    const target = await readlink(current);
    if (/^releases\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(target)) return;
  }
  throw new Error(
    `Refusing to replace unexpected workspace activation path: ${current}`,
  );
}

/** @param {string} releasesDirectory @param {string} activeReleaseName */
async function removeOldReleases(releasesDirectory, activeReleaseName) {
  const entries = await readdir(releasesDirectory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== activeReleaseName)
      .map((entry) =>
        rm(join(releasesDirectory, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
}

/** @type {CommandRunner} */
function runProcess(command, arguments_, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`${command} exited with ${code ?? signal ?? 'an error'}`),
        );
    });
  });
}

async function main() {
  const result = await bootstrapWorkspace();
  process.stdout.write(`Workspace activated: ${result.releaseDirectory}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
