import { open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { z } from 'zod';

import {
  runtimeManifestSchema,
  type RuntimeManifest,
} from '../packages/contracts/src/runtime.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'config/runtime-source.json');
const manifestPath = resolve(root, 'config/runtime-manifest.json');
const llamaDockerfilePath = resolve(root, 'llama/Dockerfile');

const sourceSchema = z.object({
  image: z.string().min(1),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      repository: z.string().min(1),
      file: z.string().min(1),
      quantization: z.string().min(1),
      contextSize: z.number().int().positive(),
      experimental: z.boolean().optional(),
    }),
  ),
});
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const siblingSchema = z.object({
  rfilename: z.string(),
  lfs: z
    .object({ oid: z.string().optional(), sha256: z.string().optional() })
    .optional(),
});
const apiSchema = z.object({ siblings: z.array(siblingSchema) });

type SourceProfile = z.infer<typeof sourceSchema>['profiles'][number];

export async function resolveProfileMetadata(
  profile: SourceProfile,
  fetcher: typeof fetch = fetch,
) {
  const api = `https://huggingface.co/api/models/${profile.repository}?blobs=true`;
  const response = await fetcher(api);
  if (!response.ok) {
    throw new Error(
      `${profile.repository} metadata returned HTTP ${response.status}`,
    );
  }
  const metadata = apiSchema.parse(await response.json());
  const sibling = metadata.siblings.find(
    (entry) => entry.rfilename === profile.file,
  );
  const oid = sibling?.lfs?.sha256 ?? sibling?.lfs?.oid;
  if (!oid || !/^[a-f0-9]{64}$/u.test(oid)) {
    throw new Error(
      `No LFS SHA-256 found for ${profile.repository}/${profile.file}`,
    );
  }
  return {
    ...profile,
    url: `https://huggingface.co/${profile.repository}/resolve/main/${encodeURIComponent(profile.file)}`,
    sha256: oid,
    source: { repository: profile.repository, revision: 'main' },
  };
}

export function validateRuntimeManifest(value: unknown): RuntimeManifest {
  return runtimeManifestSchema.parse(value);
}

export function updateDockerfileImage(source: string, image: string): string {
  const pattern = /ghcr\.io\/ggml-org\/llama\.cpp@sha256:[a-f0-9]{64}/gu;
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error('Expected exactly one pinned llama.cpp base image');
  }
  return source.replace(pattern, image);
}

export async function lockRuntime(): Promise<void> {
  const source = sourceSchema.parse(
    JSON.parse(await readFile(sourcePath, 'utf8')),
  );
  const imageResult = await execa('docker', [
    'buildx',
    'imagetools',
    'inspect',
    source.image,
    '--format',
    '{{json .Manifest.Digest}}',
  ]);
  const digest = digestSchema.parse(
    JSON.parse(imageResult.stdout.trim()) as unknown,
  );

  const profiles = await Promise.all(
    source.profiles.map((profile) => resolveProfileMetadata(profile)),
  );

  const pinnedImage = source.image.replace(/:[^/:]+$/u, `@${digest}`);
  const manifest = validateRuntimeManifest({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    image: pinnedImage,
    source: { image: source.image },
    profiles,
  });

  const manifestPartial = `${manifestPath}.partial-${process.pid}`;
  const dockerfilePartial = `${llamaDockerfilePath}.partial-${process.pid}`;
  try {
    const dockerfile = updateDockerfileImage(
      await readFile(llamaDockerfilePath, 'utf8'),
      pinnedImage,
    );
    await Promise.all([
      writeSyncedFile(
        manifestPartial,
        `${JSON.stringify(manifest, null, 2)}\n`,
      ),
      writeSyncedFile(dockerfilePartial, dockerfile),
    ]);
    JSON.parse(await readFile(manifestPartial, 'utf8'));
    await rename(manifestPartial, manifestPath);
    await rename(dockerfilePartial, llamaDockerfilePath);
  } catch (error) {
    await Promise.all([
      rm(manifestPartial, { force: true }),
      rm(dockerfilePartial, { force: true }),
    ]);
    throw error;
  }

  console.log(`Locked ${manifest.profiles.length} profiles to ${manifestPath}`);
}

async function writeSyncedFile(path: string, contents: string): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await lockRuntime();
}
