import { describe, expect, it } from 'vitest';

import { GatewayConnectionError, GatewayProblemError } from './client.js';
import { gatewayRetry, healthPollInterval } from './queries.js';

function problem(status: number): GatewayProblemError {
  return new GatewayProblemError({
    type: 'test',
    title: 'Test problem',
    status,
    detail: 'Request failed',
    requestId: 'req-1',
  });
}

describe('gateway query policy', () => {
  it('retries a connection or 503 failure at most once, never a 4xx', () => {
    expect(gatewayRetry(0, new GatewayConnectionError())).toBe(true);
    expect(gatewayRetry(1, new GatewayConnectionError())).toBe(false);
    expect(gatewayRetry(0, problem(503))).toBe(true);
    expect(gatewayRetry(1, problem(503))).toBe(false);
    expect(gatewayRetry(0, problem(409))).toBe(false);
  });

  it('polls health only while the runtime is loading or degraded', () => {
    expect(healthPollInterval('loading')).toBe(1_000);
    expect(healthPollInterval('degraded')).toBe(5_000);
    expect(healthPollInterval('ready')).toBe(false);
    expect(healthPollInterval(undefined)).toBe(false);
  });
});
