import { describe, expect, it } from 'vitest';

import { BackendConnectionError, BackendProblemError } from './backend.js';
import { backendRetry, healthPollInterval } from './queries.js';

function problem(status: number): BackendProblemError {
  return new BackendProblemError({
    type: 'test',
    title: 'Test problem',
    status,
    detail: 'Request failed',
    requestId: 'req-1',
  });
}

describe('backend query policy', () => {
  it('retries a connection or 503 failure at most once, never a 4xx', () => {
    expect(backendRetry(0, new BackendConnectionError())).toBe(true);
    expect(backendRetry(1, new BackendConnectionError())).toBe(false);
    expect(backendRetry(0, problem(503))).toBe(true);
    expect(backendRetry(1, problem(503))).toBe(false);
    expect(backendRetry(0, problem(409))).toBe(false);
  });

  it('polls health only while the runtime is loading or degraded', () => {
    expect(healthPollInterval('loading')).toBe(1_000);
    expect(healthPollInterval('degraded')).toBe(5_000);
    expect(healthPollInterval('ready')).toBe(false);
    expect(healthPollInterval(undefined)).toBe(false);
  });
});
