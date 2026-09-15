import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@chess-llama/chess-domain': resolve(
        'packages/chess-domain/src/index.ts',
      ),
      '@chess-llama/contracts': resolve('packages/contracts/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.ts'],
  },
});
