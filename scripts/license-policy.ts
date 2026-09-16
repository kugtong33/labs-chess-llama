const allowedProductionLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'GPL-3.0',
  'ISC',
  'MIT',
  '(MIT OR WTFPL)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
]);

export function assertAllowedProductionLicenses(
  licenses: Iterable<string>,
): void {
  const unreviewed = [...licenses]
    .filter((license) => !allowedProductionLicenses.has(license))
    .sort();
  if (unreviewed.length > 0) {
    throw new Error(`Unreviewed production licenses: ${unreviewed.join(', ')}`);
  }
}
