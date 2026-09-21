import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFile(resolve(repositoryRoot, path), 'utf8');

describe('maintained platform documentation', () => {
  it('keeps the README focused on the seven onboarding sections', async () => {
    const readme = await read('README.md');

    expect(
      [...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
    ).toEqual([
      'Overview',
      'Platform Support',
      'Configuration Settings',
      'Prerequisite Installation',
      'Quick Start',
      'Container Deployment',
      'License',
    ]);

    for (const [name, value] of [
      ['NGINX_PORT', '5173'],
      ['BACKEND_LOG_LEVEL', 'info'],
      ['BACKEND_DEMO_TRACE', 'false'],
      ['LLAMA_PROFILE_ID', 'qwen3-4b-q4-k-m'],
      ['LLAMA_CONTEXT_SIZE', '4096'],
      ['LLAMA_GPU_LAYERS', '99'],
    ]) {
      expect(readme).toMatch(
        new RegExp(`\\|\\s*\`${name}\`\\s*\\|\\s*\`${value}\`\\s*\\|`),
      );
    }

    expect(readme).toContain('sudo apt install -y');
    expect(readme).toContain('wsl --install -d Ubuntu-24.04');
    expect(readme).toContain('brew install bash git llama.cpp');
    expect(readme).toContain('nvm install 24');
    expect(readme).toContain('[setup guide](docs/setup.md)');
    expect(readme).toContain('[operations guide](docs/operations.md)');
    expect(readme).toContain('[deployment guide](docs/deployment.md)');
    expect(readme).toContain(
      '[model qualification guide](docs/model-benchmark.md)',
    );
    expect(readme).toContain('[LICENSE](LICENSE)');
    expect(readme).toContain(
      '[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)',
    );
  });

  it('keeps all three runtime topologies and service responsibilities explicit', async () => {
    const deployment = await read('docs/deployment.md');

    expect(deployment).toContain('Linux/WSL2 development');
    expect(deployment).toContain('Apple Silicon development');
    expect(deployment).toContain('Four-container deployment');
    expect(deployment).toMatch(/nginx.+gateway|gateway.+nginx/is);
    expect(deployment).toMatch(/web.+chess game/is);
    expect(deployment).toMatch(/backend.+API/is);
    expect(deployment).toMatch(/llama.+inference/is);
  });

  it('provides an Apple Silicon setup that ends in a runnable development stack', async () => {
    const setup = await read('docs/setup.md');

    expect(setup).toContain('Apple Silicon');
    expect(setup).toContain('brew install bash git llama.cpp');
    expect(setup).toContain('llama-server --list-devices');
    expect(setup).toContain('16 GB');
    expect(setup).toContain('./chess-llama model pull');
    expect(setup).toContain('./chess-llama doctor --format human');
    expect(setup).toContain('./chess-llama dev');
    expect(setup).toContain('Intel Macs are not supported');
  });

  it('keeps Compose Linux/WSL2-only and verifies native behavior on macOS CI', async () => {
    const [deployment, workflow] = await Promise.all([
      read('docs/deployment.md'),
      read('.github/workflows/ci.yml'),
    ]);

    expect(deployment).toContain('Linux/WSL2-only');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).toContain('brew install bash llama.cpp shellcheck shfmt');
    expect(workflow).toContain('pnpm test:macos');
  });

  it('does not describe the active runtime as CUDA-only or macOS as build-only', async () => {
    const paths = [
      'README.md',
      'docs/setup.md',
      'docs/deployment.md',
      'docs/operations.md',
      'docs/model-benchmark.md',
      'docs/bash-cli-design.md',
    ];
    const activeDocumentation = (await Promise.all(paths.map(read))).join('\n');

    expect(activeDocumentation).not.toMatch(/complete runtime is CUDA-only/i);
    expect(activeDocumentation).not.toMatch(/macOS source development/i);
    expect(activeDocumentation).not.toMatch(/Build and static checks only/i);
    expect(activeDocumentation).not.toContain('not-probed-by-benchmark');
  });
});
