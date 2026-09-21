import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  installVerifiedArtifact,
  isPortListening,
  runSupervisedCommand,
  selectRuntimeProvider,
  withOperationLock,
} from './host-runtime.js';

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('host runtime portability', () => {
  it('selects the runtime from the host OS and architecture', () => {
    expect(selectRuntimeProvider('linux', 'x64')).toBe('docker-cuda');
    expect(selectRuntimeProvider('linux', 'arm64')).toBe('docker-cuda');
    expect(selectRuntimeProvider('darwin', 'arm64')).toBe('native-metal');
    expect(() => selectRuntimeProvider('darwin', 'x64')).toThrow(
      'Apple Silicon is required',
    );
    expect(() => selectRuntimeProvider('win32', 'x64')).toThrow(
      'Unsupported runtime platform',
    );
  });

  it('installs only verified bytes and quarantines an invalid cached file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chess-llama-artifact-'));
    const destination = join(directory, 'model.gguf');
    await writeFile(destination, 'invalid');

    const result = await installVerifiedArtifact({
      destination,
      expectedSha256: sha256('verified model'),
      sourceUrl: 'https://example.invalid/model.gguf',
      fetcher: () => Promise.resolve(new Response('verified model')),
      now: () => new Date('2026-09-19T12:00:00.000Z'),
    });

    expect(result).toEqual({
      status: 'downloaded',
      path: destination,
      quarantinePath: `${destination}.invalid-2026-09-19T12-00-00-000Z`,
    });
    expect(await readFile(destination, 'utf8')).toBe('verified model');
    expect(await readFile(result.quarantinePath!, 'utf8')).toBe('invalid');
  });

  it('reuses a verified cached artifact without fetching', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chess-llama-artifact-'));
    const destination = join(directory, 'model.gguf');
    await writeFile(destination, 'verified model');
    let fetched = false;

    const result = await installVerifiedArtifact({
      destination,
      expectedSha256: sha256('verified model'),
      sourceUrl: 'https://example.invalid/model.gguf',
      fetcher: () => {
        fetched = true;
        return Promise.resolve(new Response('unused'));
      },
    });

    expect(result).toEqual({ status: 'reused', path: destination });
    expect(fetched).toBe(false);
  });

  it('locks an artifact installation while another download owns its destination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chess-llama-artifact-'));
    const destination = join(directory, 'model.gguf');
    let releaseDownload!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let downloadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      downloadStarted = resolve;
    });
    const first = installVerifiedArtifact({
      destination,
      expectedSha256: sha256('verified model'),
      sourceUrl: 'https://example.invalid/model.gguf',
      fetcher: async () => {
        downloadStarted();
        await release;
        return new Response('verified model');
      },
    });
    await started;

    const second = installVerifiedArtifact({
      destination,
      expectedSha256: sha256('verified model'),
      sourceUrl: 'https://example.invalid/model.gguf',
      fetcher: () => Promise.resolve(new Response('verified model')),
    });

    await expect(second).rejects.toThrow(
      'Another model lifecycle operation is already running',
    );
    releaseDownload();
    await expect(first).resolves.toMatchObject({ status: 'downloaded' });
  });

  it('recovers a stale operation lock but rejects a live owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chess-llama-lock-'));
    const lock = join(directory, 'model.lock');
    await mkdir(lock);
    await writeFile(join(lock, 'owner.json'), '{"pid":999999999}\n');

    await expect(
      withOperationLock(lock, () => Promise.resolve('acquired')),
    ).resolves.toBe('acquired');

    await mkdir(lock);
    await writeFile(
      join(lock, 'owner.json'),
      `${JSON.stringify({ pid: process.pid })}\n`,
    );
    await expect(
      withOperationLock(lock, () => Promise.resolve('unreachable')),
    ).rejects.toThrow('Another model lifecycle operation is already running');
  });

  it('does not retry an operation that throws EEXIST', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chess-llama-lock-'));
    const existing = join(directory, 'existing');
    await mkdir(existing);
    let attempts = 0;

    await expect(
      withOperationLock(join(directory, 'model.lock'), async () => {
        attempts += 1;
        await mkdir(existing);
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(attempts).toBe(1);
  });

  it('detects a real loopback listener without platform socket tools', async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('missing port');

    await expect(isPortListening(address.port)).resolves.toBe(true);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await expect(isPortListening(address.port)).resolves.toBe(false);
  });

  it('returns the supervised process exit status', async () => {
    await expect(
      runSupervisedCommand(process.execPath, [
        '--input-type=module',
        '-e',
        'process.exit(17)',
      ]),
    ).resolves.toBe(17);
  });
});
