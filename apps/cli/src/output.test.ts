import { describe, expect, it } from 'vitest';

import { createOutput } from './output.js';

describe('CLI output', () => {
  it('prints JSON by default and aligned rows for human diagnostics', () => {
    let stdout = '';
    const output = createOutput((text) => {
      stdout += text;
    });

    output.write({ healthy: true });
    expect(stdout).toBe('{"healthy":true}\n');

    stdout = '';
    output.write(
      {
        ok: false,
        checks: [
          { name: 'node', ok: true, detail: '24.18.1' },
          { name: 'docker', ok: false, detail: 'not running' },
        ],
      },
      'human',
    );
    expect(stdout).toContain('name');
    expect(stdout).toContain('docker');
    expect(stdout).toContain('not running');
    expect(stdout).not.toContain('[object Object]');
  });
});
