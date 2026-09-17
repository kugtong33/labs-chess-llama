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

  const manifest = validateRuntimeManifest({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    image: source.image.replace(/:[^/:]+$/u, `@${digest}`),
    source: { image: source.image },
    profiles,
  });

  const partial = `${manifestPath}.partial-${process.pid}`;
  try {
    const handle = await open(partial, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    JSON.parse(await readFile(partial, 'utf8'));
    await rename(partial, manifestPath);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }

  console.log(`Locked ${manifest.profiles.length} profiles to ${manifestPath}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await lockRuntime();
}
