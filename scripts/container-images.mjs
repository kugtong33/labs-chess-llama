import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const dockerfilePaths = [
  'nginx/Dockerfile',
  'web/Dockerfile',
  'backend/Dockerfile',
  'llama/Dockerfile',
];
const pinnedImagePattern = /^(?:docker\.io|ghcr\.io)\/.+@sha256:[a-f0-9]{64}$/u;

/**
 * @param {{ path: string, source: string }[]} dockerfiles
 * @returns {string[]}
 */
export function collectPinnedImages(dockerfiles) {
  /** @type {string[]} */
  const images = [];
  for (const dockerfile of dockerfiles) {
    const references = [
      ...dockerfile.source.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/gimu),
    ].map((match) => match[1]);
    if (references.length === 0) {
      throw new Error(`${dockerfile.path} does not declare a base image`);
    }
    for (const reference of references) {
      if (reference === undefined || !pinnedImagePattern.test(reference)) {
        throw new Error(
          `${dockerfile.path} must use a direct digest-pinned base image`,
        );
      }
      if (!images.includes(reference)) images.push(reference);
    }
  }
  return images;
}

export async function readServiceImages() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dockerfiles = await Promise.all(
    dockerfilePaths.map(async (path) => ({
      path,
      source: await readFile(resolve(root, path), 'utf8'),
    })),
  );
  return collectPinnedImages(dockerfiles);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await readServiceImages())}\n`);
}
