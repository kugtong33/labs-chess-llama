import { describe, expect, it } from 'vitest';
import { parseBackendConfig } from './config.js';

describe('backend host binding', () => {
  it.each(['127.0.0.1', '0.0.0.0'])('accepts %s', (host) => {
    expect(
      parseBackendConfig({ DATABASE_PATH: ':memory:', HOST: host }).host,
    ).toBe(host);
  });

  it('preserves the native loopback default', () => {
    expect(parseBackendConfig({ DATABASE_PATH: ':memory:' }).host).toBe(
      '127.0.0.1',
    );
  });

  it.each(['localhost', '192.168.1.10', '::', ''])('rejects %s', (host) => {
    expect(() =>
      parseBackendConfig({ DATABASE_PATH: ':memory:', HOST: host }),
    ).toThrow();
  });
});

describe('demo trace configuration', () => {
  it.each([
    [undefined, false],
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ] as const)('parses %s as %s', (value, enabled) => {
    expect(
      parseBackendConfig({
        DATABASE_PATH: ':memory:',
        CHESS_LLAMA_DEMO_TRACE: value,
      }).demoTrace,
    ).toBe(enabled);
  });
  it.each(['yes', '', 'TRUE', '2'])('rejects %s', (value) => {
    expect(() =>
      parseBackendConfig({
        DATABASE_PATH: ':memory:',
        CHESS_LLAMA_DEMO_TRACE: value,
      }),
    ).toThrow();
  });
});
