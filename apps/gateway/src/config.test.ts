import { describe, expect, it } from 'vitest';
import { parseGatewayConfig } from './config.js';

describe('demo trace configuration', () => {
  it.each([
    [undefined, false],
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ] as const)('parses %s as %s', (value, enabled) => {
    expect(
      parseGatewayConfig({
        DATABASE_PATH: ':memory:',
        CHESS_LLAMA_DEMO_TRACE: value,
      }).demoTrace,
    ).toBe(enabled);
  });
  it.each(['yes', '', 'TRUE', '2'])('rejects %s', (value) => {
    expect(() =>
      parseGatewayConfig({
        DATABASE_PATH: ':memory:',
        CHESS_LLAMA_DEMO_TRACE: value,
      }),
    ).toThrow();
  });
});
