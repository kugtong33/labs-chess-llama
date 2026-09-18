import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Service {
  image: string;
  build?: unknown;
  command: string[];
  entrypoint?: string[];
  environment: Record<string, string>;
  ports?: { host_ip: string; published: string; target: number }[];
  volumes: {
    type: string;
    source: string;
    target: string;
    read_only?: boolean;
  }[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck?: { test: string[] };
  read_only: boolean;
  init: boolean;
  cap_drop: string[];
  security_opt: string[];
  tmpfs: string[];
  user?: string;
  gpus?: { count: number }[];
}
interface ComposeConfig {
  name: string;
  services: Record<
    'client' | 'gateway' | 'llama' | 'model-bootstrap' | 'workspace-bootstrap',
    Service
  >;
  volumes: Record<string, unknown>;
}

const root = resolve(import.meta.dirname, '../..');

function config(overrides: Record<string, string> = {}): ComposeConfig {
  const result = spawnSync(
    'docker',
    ['compose', 'config', '--format', 'json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides },
    },
  );
  expect(result.error, 'Docker Compose must be installed').toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as ComposeConfig;
}

describe('deployment Compose configuration', () => {
  it('discovers the root project and resolves all five public digest-pinned services', () => {
    const deployment = config();
    expect(deployment.name).toBe('chess-llama');
    expect(Object.keys(deployment.services).sort()).toEqual([
      'client',
      'gateway',
      'llama',
      'model-bootstrap',
      'workspace-bootstrap',
    ]);
    for (const service of Object.values(deployment.services)) {
      expect(service.image).toMatch(
        /^(docker\.io\/|ghcr\.io\/).+@sha256:[a-f0-9]{64}$/u,
      );
      expect(service.build).toBeUndefined();
      expect(JSON.stringify(service)).not.toContain('${');
    }
  });

  it('publishes only loopback ports and honors environment overrides', () => {
    const { services } = config();
    for (const [name, published, target] of [
      ['client', '5173', 8080],
      ['gateway', '3001', 3001],
      ['llama', '8080', 8080],
    ] as const) {
      expect(services[name].ports).toEqual([
        expect.objectContaining({ host_ip: '127.0.0.1', published, target }),
      ]);
    }
    const overridden = config({
      CLIENT_PORT: '15173',
      GATEWAY_PORT: '13001',
      MODEL_PORT: '18080',
    });
    expect(overridden.services.client.ports?.[0]?.published).toBe('15173');
    expect(overridden.services.gateway.ports?.[0]?.published).toBe('13001');
    expect(overridden.services.llama.ports?.[0]?.published).toBe('18080');
  });

  it('gates runtime startup on completed bootstraps and healthy upstreams', () => {
    const { services } = config();
    expect(services['model-bootstrap'].depends_on).toBeUndefined();
    expect(services['workspace-bootstrap'].depends_on).toBeUndefined();
    expect(services.llama.depends_on).toMatchObject({
      'model-bootstrap': { condition: 'service_completed_successfully' },
    });
    expect(services.gateway.depends_on).toMatchObject({
      'workspace-bootstrap': { condition: 'service_completed_successfully' },
      llama: { condition: 'service_healthy' },
    });
    expect(services.client.depends_on).toMatchObject({
      gateway: { condition: 'service_healthy' },
    });
    expect(services.llama.healthcheck?.test).toEqual([
      'CMD',
      '/usr/bin/curl',
      '--fail',
      '--silent',
      'http://127.0.0.1:8080/health',
    ]);
    expect(services.gateway.healthcheck?.test.slice(0, 2)).toEqual([
      'CMD',
      'node',
    ]);
    expect(services.gateway.healthcheck?.test.join(' ')).toContain(
      '/api/health',
    );
    expect(services.client.healthcheck?.test).toEqual([
      'CMD',
      'wget',
      '-q',
      '--spider',
      'http://127.0.0.1:8080/',
    ]);
  });

  it('shares named state volumes with writable bootstraps and read-only runtime code', () => {
    const { services, volumes } = config();
    expect(Object.keys(volumes).sort()).toEqual([
      'database',
      'models',
      'pnpm',
      'workspace',
    ]);
    for (const [serviceName, source, target, readOnly] of [
      ['model-bootstrap', 'models', '/models', false],
      ['llama', 'models', '/models', true],
      ['workspace-bootstrap', 'workspace', '/workspace', false],
      ['workspace-bootstrap', 'pnpm', '/pnpm', false],
      ['workspace-bootstrap', 'database', '/data', false],
      ['gateway', 'workspace', '/workspace', true],
      ['gateway', 'database', '/data', false],
      ['client', 'workspace', '/workspace', true],
    ] as const) {
      const mount = services[serviceName].volumes.find(
        (volume) => volume.target === target,
      );
      expect(mount).toMatchObject({ type: 'volume', source });
      expect(mount?.read_only ?? false).toBe(readOnly);
    }
    for (const name of ['model-bootstrap', 'workspace-bootstrap'] as const) {
      expect(services[name].volumes).toContainEqual(
        expect.objectContaining({
          type: 'bind',
          source: root,
          target: '/source',
          read_only: true,
        }),
      );
      expect(services[name].user).toBe('0:0');
    }
    expect(services.gateway.user).toBe('1000:1000');
  });

  it('connects bootstrap outputs to runtime entrypoints and container addresses', () => {
    const { services } = config();
    expect(services['model-bootstrap'].command).toEqual([
      'node',
      '/source/infra/deployment/model-bootstrap.mjs',
    ]);
    expect(services['model-bootstrap'].environment).toMatchObject({
      MODEL_DIRECTORY: '/models',
      RUNTIME_MANIFEST_PATH: '/source/config/runtime-manifest.json',
      MODEL_PROFILE_ID: 'qwen3-4b-q4-k-m',
    });
    expect(services['workspace-bootstrap'].command).toEqual([
      'node',
      '/source/infra/deployment/workspace-bootstrap.mjs',
    ]);
    expect(services['workspace-bootstrap'].environment).toMatchObject({
      SOURCE_DIRECTORY: '/source',
      WORKSPACE_DIRECTORY: '/workspace',
      DATABASE_DIRECTORY: '/data',
      COREPACK_HOME: '/pnpm/corepack',
      npm_config_store_dir: '/pnpm/store',
    });
    expect(services.llama.entrypoint).toEqual(['/app/llama-server']);
    expect(services.llama.command).toContain('/models/current.gguf');
    expect(services.llama.gpus).toEqual([
      expect.objectContaining({ count: -1 }),
    ]);
    expect(services.gateway.command).toEqual([
      'node',
      '/workspace/current/apps/gateway/dist/main.js',
    ]);
    expect(services.gateway.environment).toMatchObject({
      HOST: '0.0.0.0',
      PORT: '3001',
      DATABASE_PATH: '/data/chess-llama.sqlite',
      LLAMA_BASE_URL: 'http://llama:8080',
      CLIENT_ORIGIN: 'http://127.0.0.1:5173',
    });
    expect(services.client.volumes).toContainEqual(
      expect.objectContaining({
        type: 'bind',
        source: resolve(root, 'infra/deployment/nginx.conf'),
        target: '/etc/nginx/conf.d/default.conf',
        read_only: true,
      }),
    );
  });

  it('hardens all containers while retaining writable scratch space', () => {
    for (const service of Object.values(config().services)) {
      expect(service.read_only).toBe(true);
      expect(service.init).toBe(true);
      expect(service.cap_drop).toEqual(['ALL']);
      expect(service.security_opt).toContain('no-new-privileges:true');
      expect(service.tmpfs).toContain('/tmp');
    }
  });

  it('keeps variable defaults in the committed environment rather than Compose interpolation', () => {
    for (const file of [
      'docker.compose.yaml',
      'infra/deployment/model.compose.yaml',
      'infra/deployment/app.compose.yaml',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      for (const interpolation of source.matchAll(/\$\{([^}]+)\}/gu)) {
        expect(interpolation[1]).toMatch(/^[A-Z][A-Z0-9_]*$/u);
      }
    }
  });
});
