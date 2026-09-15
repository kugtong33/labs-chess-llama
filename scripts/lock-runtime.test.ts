import { describe, expect, it, vi } from 'vitest';

import { resolveProfileMetadata } from './lock-runtime.mjs';

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
});
