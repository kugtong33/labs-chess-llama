import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@chess-llama/chess-domain': resolve(
        'packages/chess-domain/src/index.ts',
      ),
      '@chess-llama/contracts': resolve('packages/contracts/src/index.ts'),
      '@chess-llama/storage': resolve('packages/storage/src/index.ts'),
      '@chess-llama/stockfish-adapter': resolve(
        'packages/stockfish-adapter/src/index.ts',
      ),
      '@chess-llama/llama-protocol': resolve(
        'packages/llama-protocol/src/index.ts',
      ),
    },
  },
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'backend/src/**/*.test.ts',
      'web/src/**/*.test.{ts,tsx}',
      'web/*.test.mjs',
      'llama/**/*.test.ts',
      'scripts/*.test.ts',
    ],
  },
});
