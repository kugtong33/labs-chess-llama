import { expect, test } from '@playwright/test';

import { drag, openReadyClient, pieceAt } from './support.js';

test('plays, persists, resumes, and exports a game', async ({ page }) => {
  await openReadyClient(page);
  await page.getByRole('button', { name: 'New Game' }).click();
  await drag(page, 'e2', 'e4');
  await expect(page.getByText('I challenge your center.')).toBeVisible();
  await page.reload();
  await expect.poll(() => pieceAt(page, 'e5')).toBe('black-pawn');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PGN' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pgn$/u);
});
