import { expect, type Page } from '@playwright/test';

const pieceNames: Record<string, string> = {
  bB: 'black-bishop',
  bK: 'black-king',
  bN: 'black-knight',
  bP: 'black-pawn',
  bQ: 'black-queen',
  bR: 'black-rook',
  wB: 'white-bishop',
  wK: 'white-king',
  wN: 'white-knight',
  wP: 'white-pawn',
  wQ: 'white-queen',
  wR: 'white-rook',
};

export async function drag(
  page: Page,
  from: string,
  to: string,
): Promise<void> {
  const sourceSquare = page.locator(
    `[data-square="${from}"][data-piece]:not([data-piece=""])`,
  );
  const source = sourceSquare.getByRole('button');
  const target = page.locator(`[data-square="${to}"][data-piece]`);
  await expect(sourceSquare).toHaveCount(1);
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);
  await source.focus();
  await page.keyboard.press('Space');
  const fromFile = from.charCodeAt(0);
  const toFile = to.charCodeAt(0);
  if (fromFile !== toFile) {
    await moveKeyboardOver(
      page,
      toFile < fromFile ? 'ArrowLeft' : 'ArrowRight',
      `${to[0]}${from[1]}`,
    );
  }
  const fromRank = Number(from[1]);
  const toRank = Number(to[1]);
  if (fromRank !== toRank) {
    await moveKeyboardOver(
      page,
      toRank < fromRank ? 'ArrowDown' : 'ArrowUp',
      to,
    );
  }
  await page.keyboard.press('Space');
}

async function moveKeyboardOver(
  page: Page,
  key: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
  square: string,
): Promise<void> {
  for (let index = 0; index < 32; index += 1) {
    await page.keyboard.press(key);
    const reached = await page
      .locator('[role="status"]')
      .filter({ hasText: `droppable area ${square}` })
      .count();
    if (reached > 0) return;
  }
  throw new Error(`Keyboard drag did not reach ${square}`);
}

export async function openReadyClient(page: Page): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/');
    try {
      await expect(page.getByText(/Local AI ready/u)).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        page.getByRole('button', { name: 'New Game' }),
      ).toBeEnabled();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  const diagnostic = await page.evaluate(async () => {
    try {
      const [healthResponse, settingsResponse] = await Promise.all([
        fetch('http://127.0.0.1:3001/api/health'),
        fetch('http://127.0.0.1:3001/api/settings'),
      ]);
      return {
        healthStatus: healthResponse.status,
        health: await healthResponse.json(),
        settingsStatus: settingsResponse.status,
        settings: await settingsResponse.json(),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
        cause:
          error instanceof Error && error.cause instanceof Error
            ? `${error.cause.name}: ${error.cause.message}`
            : undefined,
      };
    }
  });
  throw new Error(
    `Client did not become ready: ${JSON.stringify(diagnostic)}`,
    { cause: lastError },
  );
}

export async function pieceAt(
  page: Page,
  square: string,
): Promise<string | null> {
  const code = await page
    .locator(`[data-square="${square}"][data-piece]`)
    .getAttribute('data-piece');
  return code ? (pieceNames[code] ?? code) : null;
}
