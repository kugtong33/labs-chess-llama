import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream: AsyncIterable<unknown> = createReadStream(path);
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk))
      throw new Error(`Unexpected data while hashing ${path}`);
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function downloadVerified(
  url: string,
  destination: string,
  expectedSha256: string,
  fetcher: typeof fetch,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.partial`;
  await rm(partial, { force: true });

  let handle;
  try {
    const response = await fetcher(url);
    if (!response.ok || response.body === null) {
      throw new Error(`Model download failed with HTTP ${response.status}`);
    }
    handle = await open(partial, 'wx');
    const hash = createHash('sha256');
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      await handle.writeFile(bytes);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;

    const actual = hash.digest('hex');
    if (actual !== expectedSha256) {
      throw new Error(
        `Model checksum mismatch for ${basename(destination)}: expected ${expectedSha256}, got ${actual}`,
      );
    }
    await rename(partial, destination);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(partial, { force: true });
    throw error;
  }
}
