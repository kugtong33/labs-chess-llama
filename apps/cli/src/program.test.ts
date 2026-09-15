import { describe, expect, it } from 'vitest';

import {
  buildProgram,
  commandPaths,
  runCli,
  type CliDependencies,
} from './program.js';

function createFakeDependencies(): CliDependencies & {
  events: string[];
  abortSignal: AbortSignal;
  stop(): void;
} {
  const events: string[] = [];
  const controller = new AbortController();
  const deps: CliDependencies = {
    events,
    signal: controller.signal,
    doctor: () => {
      events.push('doctor');
      return Promise.resolve({ ok: true, checks: [] });
    },
    database: {
      migrate: () => {
        events.push('db:migrate');
        return Promise.resolve();
      },
      status: () =>
        Promise.resolve({ current: '0000_initial', pending: false }),
      backup: () => Promise.resolve('/tmp/chess-llama.sqlite.backup'),
    },
    model: {
      pull: () => {
        events.push('model:pull');
        return Promise.resolve();
      },
      start: () => {
        events.push('model:start');
        return Promise.resolve();
      },
      stop: () => {
        events.push('model:stop');
        return Promise.resolve();
      },
      status: () =>
        Promise.resolve({ containerState: 'stopped', healthy: false }),
      logs: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    },
    gateway: {
      dev: () => {
        events.push('gateway:dev');
        return Promise.resolve();
      },
      start: () => {
        events.push('gateway:start');
        return Promise.resolve();
      },
      stop: () => {
        events.push('gateway:stop');
        return Promise.resolve();
      },
      health: () => Promise.resolve({ status: 'ready' }),
    },
    client: {
      build: () => {
        events.push('client:build');
        return Promise.resolve();
      },
      serve: () => {
        events.push('client:serve');
        return Promise.resolve();
      },
      dev: async (signal) => {
        events.push('client:dev');
        const cancellation = signal ?? controller.signal;
        await new Promise<void>((resolve) => {
          if (cancellation.aborted) return resolve();
          cancellation.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      },
      stop: () => {
        events.push('client:stop');
        return Promise.resolve();
      },
    },
    output: { write: () => undefined, error: () => undefined },
  };
  return {
    ...deps,
    events,
    abortSignal: controller.signal,
    stop: () => controller.abort(),
  };
}

describe('chess-llama command tree', () => {
  it('exposes every approved command namespace', () => {
    const paths = commandPaths(buildProgram(createFakeDependencies()));
    expect(paths).toEqual([
      'client build',
      'client dev',
      'client serve',
      'db backup',
      'db migrate',
      'db status',
      'dev',
      'doctor',
      'gateway dev',
      'gateway health',
      'gateway start',
      'model logs',
      'model pull',
      'model start',
      'model status',
      'model stop',
    ]);
  });

  it('stops only resources started by dev and preserves exit codes', async () => {
    const dependencies = createFakeDependencies();
    const pending = runCli(['dev'], dependencies, dependencies.abortSignal);
    while (!dependencies.events.includes('client:dev')) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    dependencies.stop();
    await pending;
    expect(dependencies.events).toEqual([
      'doctor',
      'db:migrate',
      'model:start',
      'gateway:start',
      'client:dev',
      'client:stop',
      'gateway:stop',
      'model:stop',
    ]);
  });

  it('maps layer failures to stable public exit codes', async () => {
    const model = createFakeDependencies();
    model.model.start = () => Promise.reject(new Error('launch failed'));
    await expect(runCli(['model', 'start'], model)).resolves.toBe(4);

    const health = createFakeDependencies();
    health.gateway.health = () =>
      Promise.reject(new Error('connection refused'));
    await expect(runCli(['gateway', 'health'], health)).resolves.toBe(5);

    const storage = createFakeDependencies();
    storage.database.migrate = () => Promise.reject(new Error('disk full'));
    await expect(runCli(['db', 'migrate'], storage)).resolves.toBe(6);

    const gateway = createFakeDependencies();
    gateway.gateway.start = () =>
      Promise.reject(
        Object.assign(new Error('missing node'), { exitCode: 127 }),
      );
    await expect(runCli(['gateway', 'start'], gateway)).resolves.toBe(4);

    const client = createFakeDependencies();
    client.client.dev = () =>
      Promise.reject(Object.assign(new Error('vite failed'), { exitCode: 9 }));
    await expect(runCli(['client', 'dev'], client)).resolves.toBe(4);

    await expect(runCli(['unknown'], createFakeDependencies())).resolves.toBe(
      2,
    );
  });

  it('preserves a nonzero model logs exit status', async () => {
    const dependencies = createFakeDependencies();
    dependencies.model.logs = () =>
      Promise.resolve({ exitCode: 17, stdout: '', stderr: 'logs failed' });

    await expect(runCli(['model', 'logs'], dependencies)).resolves.toBe(17);
  });

  it('passes the CLI cancellation signal to standalone model operations', async () => {
    const dependencies = createFakeDependencies();
    let pullSignal: AbortSignal | undefined;
    let startSignal: AbortSignal | undefined;
    dependencies.model.pull = (_profile, signal) => {
      pullSignal = signal;
      return Promise.resolve();
    };
    dependencies.model.start = (_profile, signal) => {
      startSignal = signal;
      return new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    };

    await expect(
      runCli(['model', 'pull'], dependencies, dependencies.abortSignal),
    ).resolves.toBe(0);
    const pending = runCli(
      ['model', 'start'],
      dependencies,
      dependencies.abortSignal,
    );
    await new Promise((resolve) => setImmediate(resolve));
    dependencies.stop();

    await expect(pending).resolves.toBe(0);
    expect(pullSignal).toBe(dependencies.abortSignal);
    expect(startSignal).toBe(dependencies.abortSignal);
    expect(startSignal?.aborted).toBe(true);
  });

  it('falls back to the 4B profile when persisted settings are unavailable', async () => {
    const dependencies = createFakeDependencies();
    let selected: string | undefined;
    dependencies.preferredProfile = () => Promise.reject(new Error('no db'));
    dependencies.model.pull = (profile) => {
      selected = profile;
      return Promise.resolve();
    };

    await expect(runCli(['model', 'pull'], dependencies)).resolves.toBe(0);
    expect(selected).toBe('qwen3-4b-q4-k-m');
  });

  it('rejects unsupported output formats as input errors', async () => {
    await expect(
      runCli(['model', 'status', '--format', 'xml'], createFakeDependencies()),
    ).resolves.toBe(2);
  });
});
