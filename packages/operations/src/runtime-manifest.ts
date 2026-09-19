import { readFile } from 'node:fs/promises';

import {
  runtimeManifestSchema,
  type RuntimeManifest,
  type RuntimeProfile,
} from '@chess-llama/contracts';

export async function loadRuntimeManifest(
  path: string,
): Promise<RuntimeManifest> {
  return runtimeManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export function findRuntimeProfile(
  manifest: RuntimeManifest,
  profileId: string,
): RuntimeProfile {
  const profile = manifest.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown model profile: ${profileId}`);
  return profile;
}

export function findRuntimeProfileByFile(
  manifest: RuntimeManifest,
  file: string,
): RuntimeProfile | undefined {
  return manifest.profiles.find((profile) => profile.file === file);
}
