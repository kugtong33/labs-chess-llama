import { describe, expect, it } from 'vitest';

import { runDev, type DevDependencies } from './dev.js';

describe('dev orchestration', () => {
  it('does not migrate or start layers when already cancelled', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const dependencies: DevDependencies = {
      signal: controller.signal,
      doctor: () => Promise.resolve({ ok: true, checks: [] }),
      migrate: () => {
        events.push('db:migrate');
        return Promise.resolve();
      },
      startModel: () => Promise.resolve(),
      stopModel: () => Promise.resolve(),
      startGateway: () => Promise.resolve(),
      stopGateway: () => Promise.resolve(),
      startClient: () => Promise.resolve(),
      stopClient: () => Promise.resolve(),
    };

    await expect(runDev(dependencies)).resolves.toBe(0);
    expect(events).toEqual([]);
  });

  it('does not start a layer when cancellation arrives during its probe', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    let finishProbe: ((running: boolean) => void) | undefined;
    const dependencies: DevDependencies = {
      signal: controller.signal,
      doctor: () => Promise.resolve({ ok: true, checks: [] }),
      migrate: () => Promise.resolve(),
      isModelRunning: () =>
        new Promise<boolean>((resolve) => {
          finishProbe = resolve;
        }),
      startModel: () => {
        events.push('model:start');
        return Promise.resolve();
      },
      stopModel: () => Promise.resolve(),
      startGateway: () => Promise.resolve(),
      stopGateway: () => Promise.resolve(),
      startClient: () => Promise.resolve(),
      stopClient: () => Promise.resolve(),
    };

    const pending = runDev(dependencies);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    finishProbe?.(false);

    await expect(pending).resolves.toBe(0);
    expect(events).toEqual([]);
  });

  it('returns the first child failure and still tears down owned resources', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const dependencies: DevDependencies = {
      signal: controller.signal,
      doctor: () => {
        events.push('doctor');
        return Promise.resolve({
          ok: true,
          checks: [{ name: 'test', ok: true, detail: 'ok' }],
        });
      },
      migrate: () => {
        events.push('db:migrate');
        return Promise.resolve();
      },
      startModel: () => {
        events.push('model:start');
        return Promise.resolve();
      },
      stopModel: () => {
        events.push('model:stop');
        return Promise.resolve();
      },
      startGateway: () => {
        events.push('gateway:start');
        return new Promise(() => undefined);
      },
      stopGateway: () => {
        events.push('gateway:stop');
        return Promise.resolve();
      },
      startClient: () => {
        events.push('client:dev');
        return Promise.reject(
          Object.assign(new Error('vite failed'), { exitCode: 9 }),
        );
      },
      stopClient: () => {
        events.push('client:stop');
        return Promise.resolve();
      },
    };

    await expect(runDev(dependencies)).resolves.toBe(9);
    expect(events).toEqual([
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

  it('supervises gateway and client concurrently until cancellation', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const untilAbort = () =>
      new Promise<void>((resolve) => {
        if (controller.signal.aborted) return resolve();
        controller.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
      });
    const dependencies: DevDependencies = {
      signal: controller.signal,
      doctor: () => Promise.resolve({ ok: true, checks: [] }),
      migrate: () => Promise.resolve(),
      startModel: () => Promise.resolve(),
      stopModel: () => Promise.resolve(),
      startGateway: () => {
        events.push('gateway:start');
        return untilAbort();
      },
      stopGateway: () => Promise.resolve(),
      startClient: () => {
        events.push('client:start');
        return untilAbort();
      },
      stopClient: () => Promise.resolve(),
    };

    const pending = runDev(dependencies);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(events).toEqual(['gateway:start', 'client:start']);
    } finally {
      controller.abort();
      await pending;
    }
  });

  it('does not start or stop a model that was already running', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const dependencies: DevDependencies = {
      signal: controller.signal,
      doctor: () => Promise.resolve({ ok: true, checks: [] }),
      migrate: () => Promise.resolve(),
      isModelRunning: () => Promise.resolve(true),
      startModel: () => {
        events.push('model:start');
        return Promise.resolve();
      },
      stopModel: () => {
        events.push('model:stop');
        return Promise.resolve();
      },
      startGateway: () => {
        controller.abort();
        return Promise.resolve();
      },
      stopGateway: () => Promise.resolve(),
      startClient: () => Promise.resolve(),
      stopClient: () => Promise.resolve(),
    };

    await runDev(dependencies);

    expect(events).toEqual([]);
  });

  it('maps migration and model startup failures to stable exit codes', async () => {
    const base: DevDependencies = {
      signal: new AbortController().signal,
      doctor: () => Promise.resolve({ ok: true, checks: [] }),
      migrate: () => Promise.resolve(),
      startModel: () => Promise.resolve(),
      stopModel: () => Promise.resolve(),
      startGateway: () => Promise.resolve(),
      stopGateway: () => Promise.resolve(),
      startClient: () => Promise.resolve(),
      stopClient: () => Promise.resolve(),
    };

    await expect(
      runDev({
        ...base,
        migrate: () => Promise.reject(new Error('disk full')),
      }),
    ).resolves.toBe(6);
    await expect(
      runDev({
        ...base,
        startModel: () => Promise.reject(new Error('launch failed')),
      }),
    ).resolves.toBe(4);
    await expect(
      runDev({
        ...base,
        startModel: () => Promise.reject(new Error('health timed out')),
      }),
    ).resolves.toBe(5);
  });
});
