import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadWebAsset } from './server.mjs';

/** @type {string[]} */
const fixtures = [];

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chess-llama-web-'));
  fixtures.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<main>Chess Llama</main>');
  await writeFile(join(root, 'assets', 'app.js'), 'export {};');
  return root;
}

describe('web static assets', () => {
  it('serves built assets with their content type', async () => {
    const result = await loadWebAsset(await fixture(), '/assets/app.js');

    expect(result).toMatchObject({
      status: 200,
      contentType: 'text/javascript',
    });
    if (result.status !== 200) throw new Error('Expected a web asset');
    expect(result.body.toString()).toBe('export {};');
  });

  it('falls back to the application shell for browser routes', async () => {
    const result = await loadWebAsset(await fixture(), '/play');

    expect(result).toMatchObject({ status: 200, contentType: 'text/html' });
    if (result.status !== 200)
      throw new Error('Expected the application shell');
    expect(result.body.toString()).toContain('Chess Llama');
  });

  it('returns not found for missing assets and path traversal', async () => {
    const root = await fixture();

    await expect(loadWebAsset(root, '/assets/missing.js')).resolves.toEqual({
      status: 404,
    });
    await expect(loadWebAsset(root, '/../package.json')).resolves.toEqual({
      status: 404,
    });
  });
});
