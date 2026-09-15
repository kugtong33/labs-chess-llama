import { describe, expect, it, vi } from 'vitest';

import {
  resolveProfileMetadata,
  validateRuntimeManifest,
} from './lock-runtime.mjs';

describe('runtime lock metadata', () => {
  it('requests file metadata and reads the exact sibling LFS SHA-256', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          siblings: [
            {
              rfilename: 'Qwen3-4B-Q4_K_M.gguf',
              lfs: { sha256: '7'.repeat(64) },
            },
          ],
        }),
      ),
    );

    const result = await resolveProfileMetadata(
      {
        id: 'qwen3-4b-q4-k-m',
        repository: 'Qwen/Qwen3-4B-GGUF',
        file: 'Qwen3-4B-Q4_K_M.gguf',
        quantization: 'Q4_K_M',
        contextSize: 4096,
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://huggingface.co/api/models/Qwen/Qwen3-4B-GGUF?blobs=true',
    );
    expect(result.sha256).toBe('7'.repeat(64));
  });

  it('validates the complete generated document before it can be written', () => {
    const valid = {
      schemaVersion: 1,
      generatedAt: '2026-09-15T00:00:00.000Z',
      image: `ghcr.io/ggml-org/llama.cpp@sha256:${'a'.repeat(64)}`,
      source: { image: 'ghcr.io/ggml-org/llama.cpp:server-cuda' },
      profiles: [
        {
          id: 'qwen3-4b-q4-k-m',
          repository: 'Qwen/Qwen3-4B-GGUF',
          file: 'Qwen3-4B-Q4_K_M.gguf',
          quantization: 'Q4_K_M',
          contextSize: 4096,
          url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
          sha256: '7'.repeat(64),
          source: { repository: 'Qwen/Qwen3-4B-GGUF', revision: 'main' },
        },
      ],
    };

    expect(() => validateRuntimeManifest(valid)).not.toThrow();
    expect(() =>
      validateRuntimeManifest({
        ...valid,
        generatedAt: 'not-a-date',
      }),
    ).toThrow();
  });
});
