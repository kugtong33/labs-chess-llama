import { expect, test, type APIRequestContext } from '@playwright/test';

import { drag, openReadyClient, pieceAt } from './support.js';

test('completes and persists a checkmate', async ({ page, request }) => {
  await openReadyClient(page);
  await page.getByRole('button', { name: 'New Game' }).click();
  await drag(page, 'f2', 'f3');
  await expect.poll(() => pieceAt(page, 'e5')).toBe('black-pawn');
  await drag(page, 'g2', 'g4');
  await expect(page.getByText('Game over · 0-1')).toBeVisible();

  const gameId = new URL(page.url()).pathname.split('/').at(-1);
  const response = await request.get(
    `http://127.0.0.1:3001/api/games/${gameId}`,
  );
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    status: 'completed',
    result: '0-1',
  });
  await page.reload();
  await expect(page.getByText('Game over · 0-1')).toBeVisible();
});

test('resigns and persists the result', async ({ page }) => {
  await openReadyClient(page);
  await page.getByRole('button', { name: 'New Game' }).click();
  await page.getByRole('button', { name: 'Resign' }).click();
  await expect(page.getByText('Game over · 0-1')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Game over · 0-1')).toBeVisible();
});

test('changes and reloads persistent settings', async ({ page }) => {
  await openReadyClient(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Theme').selectOption('dark');
  await page.getByLabel('Commentary style').selectOption('coach');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Theme')).toHaveValue('dark');
  await expect(page.getByLabel('Commentary style')).toHaveValue('coach');
});

test('aborts an in-flight AI request when leaving the game', async ({
  page,
  request,
}) => {
  await openReadyClient(page);
  await page.getByRole('button', { name: 'New Game' }).click();
  const before = await controlStatus(request);
  expect(
    (await request.post('http://127.0.0.1:18080/__control/delay-next')).ok(),
  ).toBe(true);

  await drag(page, 'e2', 'e4');
  await expect(page.getByText('AI is thinking…')).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect
    .poll(async () => (await controlStatus(request)).cancelledResponses)
    .toBe(before.cancelledResponses + 1);
});

async function controlStatus(
  request: APIRequestContext,
): Promise<{ cancelledResponses: number }> {
  const response = await request.get('http://127.0.0.1:18080/__control/status');
  expect(response.ok()).toBe(true);
  return (await response.json()) as { cancelledResponses: number };
}
