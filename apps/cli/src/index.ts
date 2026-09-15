#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { createDefaultDependencies } from './dependencies.js';
import { runCli } from './program.js';

export * from './dependencies.js';
export * from './output.js';
export * from './program.js';
export { resolveChessLlamaPaths } from './paths.js';
export { DockerCliAdapter } from './runtime/docker.js';
export { ModelManager } from './runtime/model-manager.js';
export {
  runtimeManifestSchema,
  runtimeProfileSchema,
} from './runtime/types.js';
export type {
  DockerAdapter,
  DockerResult,
  HealthFetcher,
  RuntimeManifest,
  RuntimeProfile,
} from './runtime/types.js';

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const dependencies = await createDefaultDependencies();
    return await runCli(argv, { ...dependencies, signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
