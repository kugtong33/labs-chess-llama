import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeManifestSchema } from './types.js';

describe('committed runtime configuration', () => {
  it('pins the CUDA image and both quantized profiles immutably', async () => {
    const manifest = runtimeManifestSchema.parse(
      JSON.parse(
        await readFile(resolve('config/runtime-manifest.json'), 'utf8'),
      ),
    );

    expect(manifest.image).toMatch(/@sha256:[a-f0-9]{64}$/u);
    expect(manifest.profiles).toEqual([
      expect.objectContaining({
        id: 'qwen3-4b-q4-k-m',
        quantization: 'Q4_K_M',
        contextSize: 4096,
      }),
      expect.objectContaining({
        id: 'qwen3-1.7b-q4-k-m',
        quantization: 'Q4_K_M',
        contextSize: 4096,
        experimental: true,
      }),
    ]);
  });

  it('keeps Compose loopback-only and hardened without an internal healthcheck', async () => {
    const compose = await readFile(resolve('infra/compose.yaml'), 'utf8');

    expect(compose).toContain('127.0.0.1:${CHESS_LLAMA_MODEL_PORT:-8080}:8080');
    expect(compose).toContain('gpus: all');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('cap_drop: [ALL]');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).not.toContain('healthcheck:');
  });
});
