import { expect, test } from '@playwright/test';

import { drag, openReadyClient } from './support.js';

test('recovers a saved human move without duplicating its ply', async ({
  page,
  request,
}) => {
  await openReadyClient(page);
  await Promise.all([
    page.waitForURL(/\/games\//u),
    page.getByRole('button', { name: 'New Game' }).click(),
  ]);
  const gameId = new URL(page.url()).pathname.split('/').at(-1);
  expect(gameId).toBeTruthy();
  const control = await request.post(
    'http://127.0.0.1:18080/__control/fail-next',
  );
  expect(control.ok()).toBe(true);

  await drag(page, 'e2', 'e4');
  await expect(page.getByRole('alert')).toContainText(
    'The request could not be completed.',
  );
  await expect(
    page.getByRole('button', { name: 'Retry AI move' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Retry AI move' }).click();
  await expect(page.getByText('I challenge your center.')).toBeVisible();

  const response = await request.get(
    `http://127.0.0.1:3001/api/games/${gameId}`,
  );
  expect(response.ok()).toBe(true);
  const game = (await response.json()) as { moves: Array<{ ply: number }> };
  expect(game.moves.map((move) => move.ply)).toEqual([1, 2]);
});
