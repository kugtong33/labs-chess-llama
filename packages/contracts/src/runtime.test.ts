import { describe, expect, it } from 'vitest';

import { runtimeManifestSchema } from './runtime.js';

describe('runtime manifest contract', () => {
  it('accepts pinned llama.cpp images and model profiles', () => {
    expect(
      runtimeManifestSchema.parse({
        schemaVersion: 1,
        generatedAt: '2026-09-15T00:00:00.000Z',
        image: `ghcr.io/ggml-org/llama.cpp@sha256:${'a'.repeat(64)}`,
        source: { image: 'ghcr.io/ggml-org/llama.cpp:server-cuda' },
        profiles: [
          {
            id: 'small',
            repository: 'owner/model',
            file: 'model.gguf',
            quantization: 'Q4_K_M',
            contextSize: 4096,
            url: 'https://example.com/model.gguf',
            sha256: 'b'.repeat(64),
            source: { repository: 'owner/model', revision: 'main' },
          },
        ],
      }).profiles[0]?.id,
    ).toBe('small');
  });
});
