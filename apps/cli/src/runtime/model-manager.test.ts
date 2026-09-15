import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ModelManager,
  type DockerAdapter,
  type HealthFetcher,
  type RuntimeManifest,
} from './model-manager.js';

const modelBytes = new TextEncoder().encode('verified qwen model');
const checksum = createHash('sha256').update(modelBytes).digest('hex');
const profile = {
  id: 'qwen3-4b-q4-k-m',
  repository: 'Qwen/Qwen3-4B-GGUF',
  file: 'Qwen3-4B-Q4_K_M.gguf',
  quantization: 'Q4_K_M',
  contextSize: 4096,
  url: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
  sha256: checksum,
  source: { repository: 'Qwen/Qwen3-4B-GGUF', revision: 'main' },
};

function createManifest(sha256 = checksum): RuntimeManifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-15T00:00:00.000Z',
    image: 'ghcr.io/ggml-org/llama.cpp@sha256:' + 'a'.repeat(64),
    source: { image: 'ghcr.io/ggml-org/llama.cpp:server-cuda' },
    profiles: [{ ...profile, sha256 }],
  };
}

async function createModelManagerHarness(
  options: {
    corruptDownload?: boolean;
    reportedModelId?: string;
    unhealthy?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'chess-llama-runtime-'));
  const modelDir = join(root, 'models');
  const dockerArgs: string[][] = [];
  const docker: DockerAdapter = {
    compose(args, env) {
      dockerArgs.push([...args, JSON.stringify(env)]);
      return Promise.resolve({ exitCode: 0, stdout: 'ok', stderr: '' });
    },
  };
  const fetcher: HealthFetcher = (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith('/v1/health')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: options.unhealthy ? 'error' : 'ok' }),
          {
            status: options.unhealthy ? 503 : 200,
          },
        ),
      );
    }
    if (url.endsWith('/v1/models')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: options.reportedModelId ?? profile.file }],
          }),
          { status: 200 },
        ),
      );
    }
    const bytes = options.corruptDownload
      ? new TextEncoder().encode('corrupt')
      : modelBytes;
    return Promise.resolve(new Response(bytes, { status: 200 }));
  };
  const manager = new ModelManager({
    manifest: createManifest(),
    paths: { modelDir, composeFile: join(root, 'compose.yaml') },
    docker,
    fetch: fetcher,
    sleep: () => Promise.resolve(),
    healthTimeoutMs: 100,
    healthIntervalMs: 1,
    now: () => 123,
  });
  return {
    manager,
    dockerArgs,
    modelDir,
    async files() {
      try {
        return await readdir(modelDir);
      } catch {
        return [];
      }
    },
    async partialFiles() {
      return (await this.files()).filter((file) => file.endsWith('.partial'));
    },
    async readModel() {
      return readFile(join(modelDir, profile.file));
    },
  };
}

describe('ModelManager', () => {
  it('downloads atomically, verifies SHA-256, and starts loopback-only', async () => {
    const harness = await createModelManagerHarness();

    await harness.manager.pull(profile.id);
    await harness.manager.start(profile.id);

    expect(await harness.readModel()).toEqual(Buffer.from(modelBytes));
    expect(await harness.files()).toEqual([profile.file]);
    expect(harness.dockerArgs.flat().join(' ')).toContain(
      '127.0.0.1:8080:8080',
    );
    expect(harness.dockerArgs.flat().join(' ')).toContain('--gpus all');
  });

  it('deletes a partial file after checksum mismatch', async () => {
    const harness = await createModelManagerHarness({ corruptDownload: true });

    await expect(harness.manager.pull(profile.id)).rejects.toThrow('checksum');
    expect(await harness.partialFiles()).toEqual([]);
  });

  it('pulls the pinned image while reusing a verified installed model', async () => {
    const harness = await createModelManagerHarness();
    await harness.manager.pull(profile.id);
    harness.dockerArgs.length = 0;

    await harness.manager.pull(profile.id);

    expect(harness.dockerArgs.flat().join(' ')).toContain('pull llama');
  });

  it('quarantines a mismatched installed file before replacing it', async () => {
    const harness = await createModelManagerHarness();
    await harness.manager.pull(profile.id);
    await writeFile(join(harness.modelDir, profile.file), 'corrupt');

    await harness.manager.pull(profile.id);

    expect((await harness.files()).sort()).toEqual(
      [profile.file, `${profile.file}.invalid-123`].sort(),
    );
    expect(await harness.readModel()).toEqual(Buffer.from(modelBytes));
  });

  it('rejects a healthy server that reports the wrong model', async () => {
    const harness = await createModelManagerHarness({
      reportedModelId: 'other.gguf',
    });
    await harness.manager.pull(profile.id);

    await expect(harness.manager.start(profile.id)).rejects.toThrow(
      `expected ${profile.file}`,
    );
  });

  it('times out when the host health endpoint never becomes ready', async () => {
    const harness = await createModelManagerHarness({ unhealthy: true });
    await harness.manager.pull(profile.id);

    await expect(harness.manager.start(profile.id)).rejects.toThrow(
      'within 100ms',
    );
  });

  it('reports model identity and delegates stop and logs', async () => {
    const harness = await createModelManagerHarness();
    await harness.manager.pull(profile.id);
    await harness.manager.start(profile.id);

    await expect(harness.manager.status()).resolves.toMatchObject({
      profileId: profile.id,
      modelId: profile.file,
      port: 8080,
    });
    await harness.manager.stop();
    await harness.manager.logs();
    expect(harness.dockerArgs.flat().join(' ')).toContain('chess-llama-model');
  });
});
