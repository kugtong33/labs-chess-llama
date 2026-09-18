import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_MODEL_FILENAME = 'current.gguf';

/**
 * Downloads and activates the selected model only after verifying its SHA-256.
 *
 * @param {{ environment?: NodeJS.ProcessEnv, fetcher?: typeof fetch }} options
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const profile = selectProfile(manifest, profileId);
  const currentPath = join(modelDirectory, CURRENT_MODEL_FILENAME);

  if (await hasExpectedChecksum(currentPath, profile.sha256)) {
    return { status: 'reused', modelPath: currentPath };
  }

  await mkdir(modelDirectory, { recursive: true });
  const partialPath = join(
    modelDirectory,
    `.${CURRENT_MODEL_FILENAME}.partial-${process.pid}`,
  );
  try {
    const response = await fetcher(profile.url);
    if (!response.ok) {
      throw new Error(`Model download returned HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Model download returned an empty response body');
    }

    const actualChecksum = await writeAndHash(response.body, partialPath);
    if (actualChecksum !== profile.sha256) {
      throw new Error(`Model checksum mismatch for profile ${profile.id}`);
    }
    await rename(partialPath, currentPath);
    return { status: 'downloaded', modelPath: currentPath };
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}

function requiredEnvironmentValue(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function selectProfile(manifest, profileId) {
  const profile = manifest?.profiles?.find((entry) => entry?.id === profileId);
  if (!profile) throw new Error(`Unknown model profile: ${profileId}`);
  if (
    typeof profile.url !== 'string' ||
    typeof profile.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(profile.sha256)
  ) {
    throw new Error(`Invalid model profile: ${profileId}`);
  }
  return profile;
}

async function hasExpectedChecksum(path, expectedChecksum) {
  try {
    return (await sha256File(path)) === expectedChecksum;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeAndHash(body, partialPath) {
  const hash = createHash('sha256');
  const handle = await open(partialPath, 'wx');
  try {
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      await writeAll(handle, bytes);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

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
