import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { arch, platform } from 'node:process';
import { fileURLToPath } from 'node:url';

export type RuntimeProvider = 'docker-cuda' | 'native-metal';

export interface InstallVerifiedArtifactOptions {
  destination: string;
  expectedSha256: string;
  sourceUrl: string;
  fetcher?: ArtifactFetcher;
  now?: () => Date;
}

interface ArtifactFetchResponse {
  ok: boolean;
  status: number;
  body: {
    getReader(): {
      read(): Promise<
        { done: false; value: Uint8Array } | { done: true; value?: Uint8Array }
      >;
    };
  } | null;
}

type ArtifactFetcher = (url: string) => Promise<ArtifactFetchResponse>;

export interface InstalledArtifact {
  status: 'downloaded' | 'reused';
  path: string;
  quarantinePath?: string;
}

export function selectRuntimeProvider(
  hostPlatform: NodeJS.Platform,
  architecture: string,
): RuntimeProvider {
  if (hostPlatform === 'linux') return 'docker-cuda';
  if (hostPlatform === 'darwin' && architecture === 'arm64') {
    return 'native-metal';
  }
  if (hostPlatform === 'darwin') {
    throw new Error(`Apple Silicon is required; detected ${architecture}`);
  }
  throw new Error(
    `Unsupported runtime platform: ${hostPlatform}/${architecture}`,
  );
}

export async function installVerifiedArtifact(
  options: InstallVerifiedArtifactOptions,
): Promise<InstalledArtifact> {
  if (!/^[a-f0-9]{64}$/u.test(options.expectedSha256)) {
    throw new Error('Expected SHA-256 must contain 64 lowercase hex digits');
  }
  await mkdir(dirname(options.destination), { recursive: true });
  const actual = await hashFileIfPresent(options.destination);
  if (actual === options.expectedSha256) {
    return { status: 'reused', path: options.destination };
  }

  let quarantinePath: string | undefined;
  if (actual !== undefined) {
    const stamp = (options.now ?? (() => new Date()))()
      .toISOString()
      .replace(/[.:]/gu, '-');
    quarantinePath = `${options.destination}.invalid-${stamp}`;
    await rename(options.destination, quarantinePath);
  }

  const partialPath = join(
    dirname(options.destination),
    `.${randomUUID()}.partial`,
  );
  let partial: Awaited<ReturnType<typeof open>> | undefined = await open(
    partialPath,
    'wx',
  );
  try {
    const fetcher: ArtifactFetcher = options.fetcher ?? fetch;
    const response = await fetcher(options.sourceUrl);
    if (!response.ok) {
      throw new Error(`Model download returned HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('Model download returned no body');
    const hash = createHash('sha256');
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      await writeAll(partial, value);
    }
    await partial.sync();
    await partial.close();
    partial = undefined;
    const downloadedSha256 = hash.digest('hex');
    if (downloadedSha256 !== options.expectedSha256) {
      throw new Error(
        `Downloaded model checksum mismatch: expected ${options.expectedSha256}, got ${downloadedSha256}`,
      );
    }
    await rename(partialPath, options.destination);
    return {
      status: 'downloaded',
      path: options.destination,
      ...(quarantinePath ? { quarantinePath } : {}),
    };
  } catch (error) {
    await partial?.close().catch(() => undefined);
    await rm(partialPath, { force: true });
    throw error;
  }
}

export async function withOperationLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      const owner = await readLockOwner(lockPath);
      if (owner !== undefined && isProcessAlive(owner)) {
        throw new Error(
          'Another model lifecycle operation is already running',
          {
            cause: error,
          },
        );
      }
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }

    try {
      await writeFile(
        join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid })}\n`,
        { flag: 'wx' },
      );
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }
  throw new Error('Unable to acquire model lifecycle lock');
}

export async function isPortListening(
  port: number,
  host = '127.0.0.1',
): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(true);
      else reject(error);
    });
    probe.listen(port, host, () => {
      probe.close(() => resolve(false));
    });
  });
}

export async function runSupervisedCommand(
  command: string,
  arguments_: readonly string[],
): Promise<number> {
  const child = spawn(command, arguments_, {
    detached: true,
    stdio: 'inherit',
  });
  const forward = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ESRCH') throw error;
    }
  };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code !== null) resolve(code);
        else resolve(signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1);
      });
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function hashFileIfPresent(path: string): Promise<string | undefined> {
  try {
    return await sha256File(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
    );
    if (bytesWritten === 0) throw new Error('Unable to write model download');
    offset += bytesWritten;
  }
}

async function readLockOwner(lockPath: string): Promise<number | undefined> {
  try {
    const value = JSON.parse(
      await readFile(join(lockPath, 'owner.json'), 'utf8'),
    ) as { pid?: unknown };
    return typeof value.pid === 'number' && Number.isInteger(value.pid)
      ? value.pid
      : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error) || error.code !== 'ESRCH';
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation === 'provider') {
    process.stdout.write(`${selectRuntimeProvider(platform, arch)}\n`);
    return;
  }
  if (operation === 'hash') {
    const path = process.argv[3];
    if (!path) throw new Error('hash requires a path');
    process.stdout.write(`${await sha256File(path)}\n`);
    return;
  }
  if (operation === 'port-in-use') {
    const port = Number(process.argv[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('port-in-use requires a valid port');
    }
    process.stdout.write(`${await isPortListening(port)}\n`);
    return;
  }
  if (operation === 'install-artifact') {
    const [destination, expectedSha256, sourceUrl] = process.argv.slice(3);
    if (!destination || !expectedSha256 || !sourceUrl) {
      throw new Error(
        'install-artifact requires destination, SHA-256, and source URL',
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        await installVerifiedArtifact({
          destination,
          expectedSha256,
          sourceUrl,
        }),
      )}\n`,
    );
    return;
  }
  if (operation === 'supervise') {
    const command = process.argv[3];
    if (!command) throw new Error('supervise requires a command');
    process.exitCode = await runSupervisedCommand(
      command,
      process.argv.slice(4),
    );
    return;
  }
  throw new Error(`Unknown host runtime operation: ${operation ?? ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
