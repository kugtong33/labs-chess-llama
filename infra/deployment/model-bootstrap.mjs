import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* global Buffer, fetch, process */

const CURRENT_MODEL_FILENAME = 'current.gguf';

/** @typedef {{ id: string, url: string, sha256: string }} ModelProfile */

/**
 * Downloads and activates the selected model only after verifying its SHA-256.
 *
 * @param {{ environment?: NodeJS.ProcessEnv, fetcher?: typeof fetch }} [options]
 * @returns {Promise<{ status: 'downloaded' | 'reused', modelPath: string }>}
 */
export async function bootstrapModel({
  environment = process.env,
  fetcher = fetch,
} = {}) {
  const profileId = requiredEnvironmentValue(environment, 'MODEL_PROFILE_ID');
  const manifestPath = requiredEnvironmentValue(
    environment,
    'RUNTIME_MANIFEST_PATH',
  );
  const modelDirectory = requiredEnvironmentValue(
    environment,
    'MODEL_DIRECTORY',
  );
  /** @type {unknown} */
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const profile = selectProfile(manifest, profileId);
  const currentPath = join(modelDirectory, CURRENT_MODEL_FILENAME);

  if (await hasExpectedChecksum(currentPath, profile.sha256)) {
    return { status: 'reused', modelPath: currentPath };
  }

  await mkdir(modelDirectory, { recursive: true });
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let partialHandle;
  /** @type {string | undefined} */
  let partialPath;
  try {
    const response = await fetcher(profile.url);
    if (!response.ok) {
      throw new Error(`Model download returned HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Model download returned an empty response body');
    }

    const partial = await createPartialFile(modelDirectory);
    partialHandle = partial.handle;
    partialPath = partial.path;
    const actualChecksum = await writeAndHash(response.body, partialHandle);
    await partialHandle.close();
    partialHandle = undefined;
    if (actualChecksum !== profile.sha256) {
      throw new Error(`Model checksum mismatch for profile ${profile.id}`);
    }
    await rename(partialPath, currentPath);
    return { status: 'downloaded', modelPath: currentPath };
  } catch (error) {
    await partialHandle?.close();
    if (partialPath) await rm(partialPath, { force: true });
    throw error;
  }
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name */
function requiredEnvironmentValue(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** @param {unknown} manifest @param {string} profileId @returns {ModelProfile} */
function selectProfile(manifest, profileId) {
  if (!isRecord(manifest) || !isUnknownArray(manifest.profiles)) {
    throw new Error('Invalid runtime manifest');
  }
  const profile = manifest.profiles.find(
    (entry) => isRecord(entry) && entry.id === profileId,
  );
  if (!isRecord(profile))
    throw new Error(`Unknown model profile: ${profileId}`);
  const { id, sha256, url } = profile;
  if (
    typeof id !== 'string' ||
    typeof url !== 'string' ||
    typeof sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(sha256)
  ) {
    throw new Error(`Invalid model profile: ${profileId}`);
  }
  return { id, sha256, url };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/** @param {unknown} value @returns {value is unknown[]} */
function isUnknownArray(value) {
  return Array.isArray(value);
}

/** @param {string} path @param {string} expectedChecksum */
async function hasExpectedChecksum(path, expectedChecksum) {
  try {
    return (await sha256File(path)) === expectedChecksum;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {unknown} error @returns {error is NodeJS.ErrnoException} */
function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}

/** @param {string} path */
async function sha256File(path) {
  const hash = createHash('sha256');
  /** @type {AsyncIterable<Buffer>} */
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/** @param {string} modelDirectory */
async function createPartialFile(modelDirectory) {
  while (true) {
    const path = join(
      modelDirectory,
      `.${CURRENT_MODEL_FILENAME}.partial-${randomUUID()}`,
    );
    try {
      return { handle: await open(path, 'wx'), path };
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') continue;
      throw error;
    }
  }
}

/** @param {AsyncIterable<Uint8Array>} body @param {import('node:fs/promises').FileHandle} handle */
async function writeAndHash(body, handle) {
  const hash = createHash('sha256');
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    hash.update(bytes);
    await writeAll(handle, bytes);
  }
  await handle.sync();
  return hash.digest('hex');
}

/** @param {import('node:fs/promises').FileHandle} handle @param {Buffer} bytes */
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
    );
    if (bytesWritten === 0) throw new Error('Unable to write model download');
    offset += bytesWritten;
  }
}

/** @returns {Promise<void>} */
async function main() {
  const result = await bootstrapModel();
  process.stdout.write(`Model ${result.status}: ${result.modelPath}\n`);
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
