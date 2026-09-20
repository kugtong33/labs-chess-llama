import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface Mount {
  type: string;
  source: string;
  target: string;
  read_only?: boolean;
}

interface Service {
  build: { context: string; dockerfile: string };
  environment?: Record<string, string>;
  ports?: { host_ip: string; published: string; target: number }[];
  volumes?: Mount[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck: { test: string[] };
  read_only: boolean;
  init: boolean;
  cap_drop: string[];
  security_opt: string[];
  tmpfs: string[];
  gpus?: { count: number }[];
}

interface ComposeConfig {
  name: string;
  services: Record<'nginx' | 'web' | 'backend' | 'llama', Service>;
  volumes: Record<string, unknown>;
}

const root = resolve(import.meta.dirname, '..');

function config(overrides: Record<string, string> = {}): ComposeConfig {
  const result = spawnSync(
    'docker',
    ['compose', '--file', 'compose.yaml', 'config', '--format', 'json'],
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

describe('four-service Compose topology', () => {
  it('builds exactly one image for each literal service name', () => {
    const deployment = config();

    expect(deployment.name).toBe('chess-llama');
    expect(Object.keys(deployment.services).sort()).toEqual([
      'backend',
      'llama',
      'nginx',
      'web',
    ]);
    for (const name of Object.keys(deployment.services) as Array<
      keyof typeof deployment.services
    >) {
      expect(deployment.services[name].build).toMatchObject({
        context: root,
        dockerfile: `${name}/Dockerfile`,
      });
    }
  });

  it('publishes only the loopback Nginx port', () => {
    const { services } = config();

    expect(services.nginx.ports).toEqual([
      expect.objectContaining({
        host_ip: '127.0.0.1',
        published: '5173',
        target: 8080,
      }),
    ]);
    for (const name of ['web', 'backend', 'llama'] as const) {
      expect(services[name].ports).toBeUndefined();
    }
    expect(
      config({ NGINX_PORT: '15173' }).services.nginx.ports?.[0],
    ).toMatchObject({ published: '15173' });
  });

  it('expresses the gateway, application, API, and inference responsibilities directly', () => {
    const { services } = config();

    expect(services.nginx.depends_on).toMatchObject({
      web: { condition: 'service_healthy' },
      backend: { condition: 'service_healthy' },
    });
    expect(services.web.depends_on).toBeUndefined();
    expect(services.backend.depends_on).toMatchObject({
      llama: { condition: 'service_healthy' },
    });
    expect(services.llama.depends_on).toBeUndefined();
    expect(services.backend.environment).toEqual({
      CHESS_LLAMA_DEMO_TRACE: 'false',
      DATABASE_PATH: '/data/chess-llama.sqlite',
      HOST: '0.0.0.0',
      LLAMA_BACKEND: 'CUDA',
      LLAMA_BASE_URL: 'http://llama:8080',
      LOG_LEVEL: 'info',
      NODE_ENV: 'production',
      PORT: '3001',
    });
    expect(services.llama.environment).toMatchObject({
      LLAMA_CONTEXT_SIZE: '4096',
      LLAMA_GPU_LAYERS: '99',
      LLAMA_MANIFEST_PATH: '/opt/chess-llama/runtime-manifest.json',
      LLAMA_MODEL_DIRECTORY: '/models',
      LLAMA_PROFILE_ID: 'qwen3-4b-q4-k-m',
    });
    expect(services.llama.gpus).toEqual([
      expect.objectContaining({ count: -1 }),
    ]);
  });

  it('persists only backend data and llama models', () => {
    const { services, volumes } = config();

    expect(Object.keys(volumes).sort()).toEqual(['database', 'models']);
    expect(services.backend.volumes).toContainEqual(
      expect.objectContaining({
        type: 'volume',
        source: 'database',
        target: '/data',
      }),
    );
    expect(services.llama.volumes).toContainEqual(
      expect.objectContaining({
        type: 'volume',
        source: 'models',
        target: '/models',
      }),
    );
    expect(services.nginx.volumes).toBeUndefined();
    expect(services.web.volumes).toBeUndefined();
  });

  it('health-checks every responsibility at its own boundary', () => {
    const { services } = config();

    expect(services.nginx.healthcheck.test).toEqual([
      'CMD',
      'wget',
      '-q',
      '--spider',
      'http://127.0.0.1:8080/',
    ]);
    expect(services.web.healthcheck.test.join(' ')).toContain(
      'http://127.0.0.1:4173/',
    );
    expect(services.backend.healthcheck.test.join(' ')).toContain(
      'http://127.0.0.1:3001/api/health',
    );
    expect(services.llama.healthcheck.test).toEqual([
      'CMD',
      '/usr/bin/curl',
      '--fail',
      '--silent',
      'http://127.0.0.1:8080/health',
    ]);
  });

  it('hardens all four containers with writable state isolated to volumes', () => {
    for (const service of Object.values(config().services)) {
      expect(service.read_only).toBe(true);
      expect(service.init).toBe(true);
      expect(service.cap_drop).toEqual(['ALL']);
      expect(service.security_opt).toContain('no-new-privileges:true');
      expect(service.tmpfs).toContain('/tmp');
    }
  });

  it('keeps the public configuration surface to the six literal settings', () => {
    const assignments = readFileSync(resolve(root, '.env'), 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line !== '' && !line.startsWith('#'));

    expect(assignments.map((line) => line.split('=', 1)[0])).toEqual([
      'NGINX_PORT',
      'BACKEND_LOG_LEVEL',
      'BACKEND_DEMO_TRACE',
      'LLAMA_PROFILE_ID',
      'LLAMA_CONTEXT_SIZE',
      'LLAMA_GPU_LAYERS',
    ]);
    const composeSource = readFileSync(resolve(root, 'compose.yaml'), 'utf8');
    for (const interpolation of composeSource.matchAll(/\$\{([^}]+)\}/gu)) {
      expect(interpolation[1]).toMatch(/^[A-Z][A-Z0-9_]*$/u);
    }
    expect(existsSync(resolve(root, 'docker.compose.yaml'))).toBe(false);
    expect(existsSync(resolve(root, 'infra'))).toBe(false);
  });

  it('routes browser traffic through Nginx without buffering API streams', () => {
    const nginx = readFileSync(resolve(root, 'nginx/default.conf'), 'utf8');

    expect(nginx).toMatch(
      /location \/api[\s\S]*proxy_pass http:\/\/backend:3001;/u,
    );
    expect(nginx).toMatch(
      /location \/ \{[\s\S]*proxy_pass http:\/\/web:4173;/u,
    );
    expect(nginx).toContain('proxy_buffering off;');
    expect(nginx).toContain('proxy_cache off;');
  });
});
