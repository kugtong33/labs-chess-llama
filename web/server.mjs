import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* global process */

const contentTypes = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

/** @typedef {{ status: 404 } | { status: 200, contentType: string, body: Buffer }} WebAsset */

/** @param {string} root @param {string} requestPath @returns {Promise<WebAsset>} */
export async function loadWebAsset(root, requestPath) {
  const assetRoot = resolve(root);
  let pathname;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch {
    return { status: 404 };
  }
  const requestedFile = resolve(assetRoot, `.${pathname}`);
  if (
    requestedFile !== assetRoot &&
    !requestedFile.startsWith(`${assetRoot}${sep}`)
  ) {
    return { status: 404 };
  }

  const fallback = extname(pathname) === '';
  const file =
    pathname === '/' ? resolve(assetRoot, 'index.html') : requestedFile;
  try {
    return await assetResponse(file);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    if (!fallback) return { status: 404 };
    return assetResponse(resolve(assetRoot, 'index.html'));
  }
}

/** @param {string} path @returns {Promise<WebAsset>} */
async function assetResponse(path) {
  return {
    status: 200,
    contentType: contentTypes.get(extname(path)) ?? 'application/octet-stream',
    body: await readFile(path),
  };
}

/** @param {unknown} error */
function isMissingFile(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'EISDIR')
  );
}

export function createWebServer(
  assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'dist'),
) {
  return createServer((request, response) => {
    void respondToRequest(assetRoot, request, response);
  });
}

/**
 * @param {string} assetRoot
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function respondToRequest(assetRoot, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = new URL(request.url ?? '/', 'http://web').pathname;
    const result = await loadWebAsset(assetRoot, pathname);
    if (result.status === 404) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': result.contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : result.body);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    response.writeHead(500).end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  createWebServer().listen(4173, '0.0.0.0', () => {
    process.stdout.write('web listening on http://0.0.0.0:4173\n');
  });
}
