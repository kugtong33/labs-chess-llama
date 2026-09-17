import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findRuntimeProfile,
  findRuntimeProfileByFile,
  loadRuntimeManifest,
} from './runtime.js';

describe('runtime manifest operations', () => {
  it('loads and selects a validated profile', async () => {
    const manifest = await loadRuntimeManifest(
      resolve(import.meta.dirname, '../../../config/runtime-manifest.json'),
    );

    expect(findRuntimeProfile(manifest, 'qwen3-4b-q4-k-m')).toMatchObject({
      id: 'qwen3-4b-q4-k-m',
      quantization: 'Q4_K_M',
    });
  });

  it('rejects unknown profiles', async () => {
    const manifest = await loadRuntimeManifest(
      resolve(import.meta.dirname, '../../../config/runtime-manifest.json'),
    );

    expect(() => findRuntimeProfile(manifest, 'missing')).toThrow(
      'Unknown model profile: missing',
    );
  });

  it('maps a loaded GGUF filename back to its profile', async () => {
    const manifest = await loadRuntimeManifest(
      resolve(import.meta.dirname, '../../../config/runtime-manifest.json'),
    );

    expect(findRuntimeProfileByFile(manifest, 'Qwen3-4B-Q4_K_M.gguf')?.id).toBe(
      'qwen3-4b-q4-k-m',
    );
  });
});
