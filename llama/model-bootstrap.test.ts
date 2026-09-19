import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapModel } from './model-bootstrap.mjs';

const modelBytes = Buffer.from('verified model weights');
const modelChecksum = createHash('sha256').update(modelBytes).digest('hex');
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createFixture(
  options: {
    profileId?: string;
    sha256?: string;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'chess-llama-model-bootstrap-'));
  fixtures.push(root);
  const manifestPath = join(root, 'runtime-manifest.json');
  const modelDirectory = join(root, 'models');
  const profileId = options.profileId ?? 'test-profile';
  await writeFile(
    manifestPath,
    JSON.stringify({
      profiles: [
        {
          id: profileId,
          file: 'test-model.gguf',
          url: 'https://models.example.test/test-model.gguf',
          sha256: options.sha256 ?? modelChecksum,
        },
      ],
    }),
  );
  return {
    manifestPath,
    modelDirectory,
    environment: {
      LLAMA_PROFILE_ID: profileId,
      LLAMA_MANIFEST_PATH: manifestPath,
      LLAMA_MODEL_DIRECTORY: modelDirectory,
    },
  };
}

describe('model bootstrap', () => {
  it('rejects unknown model profiles before downloading', async () => {
    const fixture = await createFixture();
    const fetcher = vi.fn();

    await expect(
      bootstrapModel({
        environment: { ...fixture.environment, LLAMA_PROFILE_ID: 'missing' },
        fetcher,
      }),
    ).rejects.toThrow('Unknown model profile: missing');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reuses a checksum-valid active model without downloading', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.modelDirectory, { recursive: true });
    await writeFile(join(fixture.modelDirectory, 'current.gguf'), modelBytes);
    const fetcher = vi.fn();

    await expect(
      bootstrapModel({ environment: fixture.environment, fetcher }),
    ).resolves.toMatchObject({ status: 'reused' });

    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      readFile(join(fixture.modelDirectory, 'current.gguf')),
    ).resolves.toEqual(modelBytes);
  });

  it('streams a verified download and atomically activates it', async () => {
    const fixture = await createFixture();
    const fetcher = vi.fn(() => Promise.resolve(new Response(modelBytes)));

    await expect(
      bootstrapModel({ environment: fixture.environment, fetcher }),
    ).resolves.toMatchObject({ status: 'downloaded' });

    expect(fetcher).toHaveBeenCalledWith(
      'https://models.example.test/test-model.gguf',
    );
    await expect(
      readFile(join(fixture.modelDirectory, 'current.gguf')),
    ).resolves.toEqual(modelBytes);
    await expect(readdir(fixture.modelDirectory)).resolves.toEqual([
      'current.gguf',
    ]);
  });

  it('cleans up the partial download when the server returns an HTTP error', async () => {
    const fixture = await createFixture();
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );

    await expect(
      bootstrapModel({ environment: fixture.environment, fetcher }),
    ).rejects.toThrow('Model download returned HTTP 503');

    await expect(
      access(join(fixture.modelDirectory, 'current.gguf')),
    ).rejects.toThrow();
    await expect(readdir(fixture.modelDirectory)).resolves.toEqual([]);
  });

  it('keeps the previous active model and removes the partial file on checksum mismatch', async () => {
    const fixture = await createFixture();
    const previousModel = Buffer.from('previous model weights');
    await mkdir(fixture.modelDirectory, { recursive: true });
    await writeFile(
      join(fixture.modelDirectory, 'current.gguf'),
      previousModel,
    );
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(Buffer.from('tampered model'))),
    );

    await expect(
      bootstrapModel({ environment: fixture.environment, fetcher }),
    ).rejects.toThrow('Model checksum mismatch for profile test-profile');

    await expect(
      readFile(join(fixture.modelDirectory, 'current.gguf')),
    ).resolves.toEqual(previousModel);
    await expect(readdir(fixture.modelDirectory)).resolves.toEqual([
      'current.gguf',
    ]);
  });

  it('does not take ownership of a colliding stale partial file', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.modelDirectory, { recursive: true });
    const stalePartial = join(
      fixture.modelDirectory,
      `.current.gguf.partial-${process.pid}`,
    );
    await writeFile(stalePartial, 'another bootstrap owns this file');
    const fetcher = vi.fn(() => Promise.resolve(new Response(modelBytes)));

    await expect(
      bootstrapModel({ environment: fixture.environment, fetcher }),
    ).resolves.toMatchObject({ status: 'downloaded' });

    await expect(readFile(stalePartial, 'utf8')).resolves.toBe(
      'another bootstrap owns this file',
    );
    await expect(readdir(fixture.modelDirectory)).resolves.toHaveLength(2);
  });
});
