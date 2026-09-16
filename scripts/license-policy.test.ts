import { describe, expect, it } from 'vitest';

import { assertAllowedProductionLicenses } from './license-policy.js';

describe('production license policy', () => {
  it('accepts the reviewed runtime license expressions', () => {
    expect(() =>
      assertAllowedProductionLicenses([
        'MIT',
        'BSD-2-Clause',
        'ISC',
        'Apache-2.0',
        '(MIT OR WTFPL)',
        'BSD-3-Clause',
        '(BSD-2-Clause OR MIT OR Apache-2.0)',
        'GPL-3.0',
        '0BSD',
      ]),
    ).not.toThrow();
  });

  it('rejects an unreviewed license before notices are accepted', () => {
    expect(() =>
      assertAllowedProductionLicenses(['MIT', 'AGPL-3.0-only']),
    ).toThrow('Unreviewed production licenses: AGPL-3.0-only');
  });
});
