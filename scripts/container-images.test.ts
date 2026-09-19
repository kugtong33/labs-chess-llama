import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectPinnedImages, readServiceImages } from './container-images.mjs';

describe('container image discovery', () => {
  it('deduplicates digest-pinned base images from service Dockerfiles', () => {
    expect(
      collectPinnedImages([
        {
          path: 'web/Dockerfile',
          source: `FROM docker.io/library/node:24@sha256:${'a'.repeat(64)} AS build\nFROM docker.io/library/node:24@sha256:${'a'.repeat(64)}`,
        },
        {
          path: 'nginx/Dockerfile',
          source: `FROM docker.io/nginxinc/nginx-unprivileged:stable@sha256:${'b'.repeat(64)}`,
        },
      ]),
    ).toEqual([
      `docker.io/library/node:24@sha256:${'a'.repeat(64)}`,
      `docker.io/nginxinc/nginx-unprivileged:stable@sha256:${'b'.repeat(64)}`,
    ]);
  });

  it('rejects mutable or unrecognized base image references', () => {
    expect(() =>
      collectPinnedImages([
        {
          path: 'llama/Dockerfile',
          source: 'FROM ghcr.io/ggml-org/llama.cpp:server-cuda',
        },
      ]),
    ).toThrow('llama/Dockerfile must use a direct digest-pinned base image');
  });

  it('keeps the service Dockerfiles aligned with the runtime manifest', async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, '../config/runtime-manifest.json'),
        'utf8',
      ),
    ) as { image: string };
    const images = await readServiceImages();

    expect(images).toHaveLength(3);
    expect(images).toContain(manifest.image);
  });
});
