/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { expect, test, type Page } from '@playwright/test';

// Network fixtures keep geometry tests deterministic without requiring an AI model.
import {
  game,
  gameAfterTurn,
  gameId,
  readyHealth,
  settings,
} from '../../web/src/test/fixtures.js';
import type {
  AiDecisionView,
  GameView,
} from '../../packages/contracts/src/index.js';
import { drag } from './support.js';

async function expectFits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return {
          width: root.scrollWidth <= innerWidth,
          height: root.scrollHeight <= innerHeight,
        };
      }),
    )
    .toEqual({ width: true, height: true });
  const board = await page
    .getByLabel('Game board', { exact: true })
    .boundingBox();
  expect(board).not.toBeNull();
  expect(board!.width).toBeGreaterThan(100);
  expect(Math.abs(board!.width - board!.height)).toBeLessThan(2);
  expect(board!.y + board!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await expect(
    page.getByRole('button', { name: 'Resign', exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Download PGN' }),
  ).toBeInViewport();
}

test('fits the game to the viewport and keeps small-screen details separate', async ({
  page,
}) => {
  await openFixture(page, game({ currentFen: startingFen }));
  await expect(page.getByLabel('Game board', { exact: true })).toBeVisible();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [768, 1024],
    [1366, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expectFits(page);
    const board = await page
      .getByLabel('Game board', { exact: true })
      .boundingBox();
    const toolbar = await page.locator('.game-toolbar').boundingBox();
    expect(
      Math.abs(board!.x + board!.width / 2 - (toolbar!.x + toolbar!.width / 2)),
    ).toBeLessThan(2);
    await expectNoScroll(page);
    if (width! < 900 || height! < 600) {
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      await expect(
        page.getByRole('tab', { name: 'Moves', exact: true }),
      ).toBeVisible();
      await page.getByRole('tab', { name: 'Moves', exact: true }).click();
      await expect(page.getByText('The opening move is yours.')).toBeVisible();
      await expectNoScroll(page);
      await page.getByRole('button', { name: 'Back to game' }).click();
      await expect(
        page.getByRole('button', { name: 'Details', exact: true }),
      ).toBeFocused();
      await expectFits(page);
    }
  }
});

async function expectNoScroll(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrollable = [
          ...document.querySelectorAll<HTMLElement>('*'),
        ].filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            ((['auto', 'scroll'].includes(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1) ||
              (['auto', 'scroll'].includes(style.overflowX) &&
                element.scrollWidth > element.clientWidth + 1))
          );
        });
        return scrollable.map(
          (element) => `${element.tagName}.${element.className}`,
        );
      }),
    )
    .toEqual([]);
  await page.mouse.wheel(500, 500);
  expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([
    0, 0,
  ]);
}

const startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
async function openFixture(
  page: Page,
  current: GameView,
  decisions?: AiDecisionView[],
) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: readyHealth }),
  );
  await page.route('**/api/settings', (route) =>
    route.fulfill({ json: settings }),
  );
  await page.route(`**/api/games/${gameId}`, (route) =>
    route.fulfill({ json: current }),
  );
  await page.route(`**/api/games/${gameId}/decisions`, (route) =>
    route.fulfill({
      json:
        decisions ?? (current.lastAiDecision ? [current.lastAiDecision] : []),
    }),
  );
  await page.route('**/api/demo/events?*', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: '' }),
  );
  await page.goto(`/games/${gameId}`);
  await expect(page.getByLabel('Game board', { exact: true })).toBeVisible();
}

test('paginates long content, follows new moves only at the end, and replays a selected decision', async ({
  page,
}) => {
  await page.clock.install();
  const current = gameAfterTurn();
  current.currentFen = startingFen;
  const sample = current.moves;
  current.moves = Array.from({ length: 120 }, (_, index) => ({
    ...sample[index % 2]!,
    id: crypto.randomUUID(),
    ply: index + 1,
  }));
  current.lastAiDecision!.moveId = current.moves[119]!.id;
  current.lastAiDecision!.commentary = `${'Control the center and develop your pieces. '.repeat(5)}End of explanation.`;
  await page.setViewportSize({ width: 390, height: 844 });
  const earlierDecision = {
    ...current.lastAiDecision!,
    id: crypto.randomUUID(),
    moveId: current.moves[1]!.id,
    commentary: 'Opening replay explanation.',
  };
  await openFixture(page, current, [earlierDecision, current.lastAiDecision!]);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const ai = page.getByRole('tabpanel', { name: 'AI', exact: true });
  const nextAi = ai.getByRole('button', { name: 'Next' });
  await expect(nextAi).toBeEnabled();
  let pages = 0;
  while (await nextAi.isEnabled()) {
    await expectNoScroll(page);
    await nextAi.click();
    expect(++pages).toBeLessThan(40);
  }
  await expect(ai.getByText('CPU-test-double', { exact: true })).toHaveCount(0);
  await expect(ai.getByText('CUDA', { exact: true }).last()).toBeInViewport();
  await page.getByRole('tab', { name: 'Moves', exact: true }).click();
  const moves = page.getByRole('tabpanel', { name: 'Moves', exact: true });
  await expect(moves.getByText('60.', { exact: true })).toBeInViewport();
  await expect(moves.getByRole('button', { name: 'Next' })).toBeDisabled();
  await moves.getByRole('button', { name: 'Previous' }).click();
  const earlierPage = await moves.getByText(/Page \d+ of/).textContent();
  current.moves.push(
    ...sample.map((move, index) => ({
      ...move,
      id: crypto.randomUUID(),
      ply: 121 + index,
    })),
  );
  await page.clock.fastForward(6000);
  // Health/game refetch on reconnect provides a real query update without navigation.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(moves.getByText('122 ply')).toBeAttached();
  await expect(moves.getByText(/Page \d+ of/)).toHaveText(earlierPage!);
  while (await moves.getByRole('button', { name: 'Next' }).isEnabled())
    await moves.getByRole('button', { name: 'Next' }).click();
  current.moves.push(
    ...Array.from({ length: 42 }, (_, index) => ({
      ...sample[index % 2]!,
      id: crypto.randomUUID(),
      ply: 123 + index,
    })),
  );
  await page.clock.fastForward(6000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(moves.getByText('164 ply')).toBeAttached();
  await expect(moves.getByText('82.', { exact: true })).toBeInViewport();
  await expect(moves.getByRole('button', { name: 'Next' })).toBeDisabled();
  while (await moves.getByRole('button', { name: 'Previous' }).isEnabled())
    await moves.getByRole('button', { name: 'Previous' }).click();
  await moves.getByRole('button', { name: 'e5', exact: true }).first().click();
  await expect(ai.getByText('Opening replay explanation.')).toBeInViewport();
  await expect(ai.getByText(/Page 1 of/)).toBeVisible();
  await expect(
    page.getByRole('tab', { name: 'AI', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('tab', { name: 'AI', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expectNoScroll(page);
});

test('keeps promotion choices in the viewport and restores focus on Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFixture(
    page,
    game({ currentFen: '7k/4P3/8/8/8/8/8/K7 w - - 0 1' }),
  );
  await drag(page, 'e7', 'e8');
  const dialog = page.getByRole('dialog', { name: 'Choose promotion' });
  await expect(dialog).toBeVisible();
  for (const name of ['queen', 'rook', 'bishop', 'knight']) {
    await expect(
      dialog.getByRole('button', { name: `Promote to ${name}` }),
    ).toBeInViewport();
  }
  await expectNoScroll(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('[data-square="e7"][data-piece="wP"]').getByRole('button'),
  ).toBeFocused();
});

test('supports keyboard tabs and reflows at 200 percent zoom', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openFixture(page, game({ currentFen: startingFen }));
  const ai = page.getByRole('tab', { name: 'AI', exact: true });
  await ai.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'Pipeline', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    page.getByRole('tab', { name: 'Moves', exact: true }),
  ).toBeFocused();
  // Browser zoom halves the CSS viewport and doubles device pixels.
  await page.setViewportSize({ width: 683, height: 384 });
  await expect(
    page.getByRole('button', { name: 'Details', exact: true }),
  ).toBeFocused();
  await expectFits(page);
  await expectNoScroll(page);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByLabel('Game board', { exact: true })).toBeVisible();
  await expectNoScroll(page);
});

test('paginates expanded technical events and long error details without scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const current = game({ currentFen: startingFen, status: 'awaiting_ai' });
  await openFixture(page, current);
  const events = Array.from({ length: 120 }, (_, index) => ({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    sequence: index,
    timestamp: '2026-09-18T00:00:00.000Z',
    traceId: gameId,
    requestId: 'request-ui-test',
    gameId,
    ply: 2,
    layer: 'web',
    stage: 'move_submitted',
    status: 'completed',
    summary: `Event ${index + 1}: ${'Submitted move for analysis. '.repeat(7)}`,
    data: {},
  }));
  await page.route('**/api/demo/events?*', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: events
        .map(
          (event) =>
            `event: decision-trace\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(''),
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('tab', { name: 'Pipeline', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Pipeline', exact: true });
  // Keyboard focus must turn to the page containing the disclosure.
  await panel.getByText('Technical details', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Next' })).toBeEnabled();
  let pageCount = 0;
  while (await panel.getByRole('button', { name: 'Next' }).isEnabled()) {
    await panel.getByRole('button', { name: 'Next' }).click();
    await expectNoScroll(page);
    expect(++pageCount).toBeLessThan(150);
  }
  const alignment = await panel
    .locator('.pipeline-details li')
    .last()
    .evaluate((item) => {
      const viewport = item.closest('.page-viewport')!.getBoundingClientRect();
      // A multi-column item has several fragments; IntersectionObserver only
      // considers its first fragment, which is on the previous page here.
      const last = Array.from(item.getClientRects()).at(-1)!;
      return {
        right: last.right,
        left: last.left,
        top: last.top,
        bottom: last.bottom,
        viewport: viewport.toJSON() as {
          right: number;
          left: number;
          top: number;
          bottom: number;
        },
      };
    });
  expect(alignment.right).toBeLessThanOrEqual(alignment.viewport.right - 3);
  expect(alignment.left).toBeGreaterThanOrEqual(alignment.viewport.left + 3);
  expect(alignment.top).toBeGreaterThanOrEqual(alignment.viewport.top + 3);
  expect(alignment.bottom).toBeLessThanOrEqual(alignment.viewport.bottom - 3);

  await page.getByRole('button', { name: 'Back to game' }).click();
  await page.route(`**/api/games/${gameId}/moves/ai`, (route) =>
    route.fulfill({
      status: 503,
      json: {
        type: 'model-unavailable',
        title: 'Model unavailable',
        status: 503,
        detail: `${'The model stopped during this turn. '.repeat(40)}End of error.`,
        requestId: 'ui-test',
        gameId,
        gameStatus: 'awaiting_ai',
      },
    }),
  );
  await page.getByRole('button', { name: 'Retry AI move' }).click();
  await page.getByRole('button', { name: 'Error details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Game problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeEnabled();
  while (await dialog.getByRole('button', { name: 'Next' }).isEnabled())
    await dialog.getByRole('button', { name: 'Next' }).click();
  await expectNoScroll(page);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Error details' }),
  ).toBeFocused();
  await expectFits(page);
});

test('preserves the home design within the shared viewport when leaving a game', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openFixture(page, game({ currentFen: startingFen }));
  await expectFits(page);
  await expect(page.getByRole('contentinfo')).toBeHidden();

  await page.getByRole('link', { name: 'chess-llama home' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Play chess with a local language model.',
    }),
  ).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  const home = await page.evaluate(() => ({
    headingSize: Number.parseFloat(
      getComputedStyle(document.querySelector('h1')!).fontSize,
    ),
    width: document.querySelector('.app-shell')!.getBoundingClientRect().width,
    scrollable: getComputedStyle(document.documentElement).overflowY,
  }));
  expect(home.width).toBe(1180);
  expect(home.headingSize).toBeGreaterThan(60);
  expect(['hidden', 'clip']).toContain(home.scrollable);

  await page.goBack();
  await expectFits(page);
  await expectNoScroll(page);
  await expect(page.getByRole('contentinfo')).toBeHidden();

  await page.getByRole('link', { name: 'chess-llama home' }).click();
  await page.setViewportSize({ width: 390, height: 568 });
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await expect(page.getByRole('contentinfo')).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('keeps game controls aligned with the board and closes unused gaps', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openFixture(page, game({ currentFen: startingFen }));
  const board = await page
    .getByLabel('Game board', { exact: true })
    .boundingBox();
  const toolbar = await page.locator('.game-toolbar').boundingBox();
  const details = await page.locator('.game-sidebar').boundingBox();
  expect(
    Math.abs(toolbar!.x + toolbar!.width / 2 - (board!.x + board!.width / 2)),
  ).toBeLessThan(2);
  expect(details!.x - (board!.x + board!.width)).toBeLessThan(48);
  expect(details!.width).toBeLessThanOrEqual(384);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectFits(page);
  const mobileBoard = await page
    .getByLabel('Game board', { exact: true })
    .boundingBox();
  const mobileToolbar = await page.locator('.game-toolbar').boundingBox();
  expect(
    mobileToolbar!.y - (mobileBoard!.y + mobileBoard!.height),
  ).toBeLessThan(24);
  const actions = page.getByRole('group', {
    name: 'Game actions',
    exact: true,
  });
  const buttons = await actions.getByRole('button').all();
  const sizes = await Promise.all(
    buttons.map((button) => button.boundingBox()),
  );
  for (const size of sizes) expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(sizes[0]!.width - sizes[1]!.width)).toBeLessThan(1);
  expect(Math.abs(sizes[2]!.width - sizes[3]!.width)).toBeLessThan(1);
  await expectNoScroll(page);
});

test('shows the complete keyboard focus outline inside paginated details', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 768 });
  await openFixture(page, game({ currentFen: startingFen }));
  await page.getByRole('tab', { name: 'Pipeline', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const summary = page.getByText('Technical details', { exact: true });
  await expect(summary).toBeFocused();
  const bounds = await summary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = element.closest('.page-viewport')!.getBoundingClientRect();
    const style = getComputedStyle(element);
    const ring =
      Number.parseFloat(style.outlineWidth) +
      Number.parseFloat(style.outlineOffset);
    return {
      left: rect.left - ring,
      right: rect.right + ring,
      viewportLeft: viewport.left,
      viewportRight: viewport.right,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.viewportLeft);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportRight);
});

test('contains every page in the viewport with accessible component scrolling', async ({
  page,
}) => {
  await openFixture(page, game({ currentFen: startingFen }));
  await page.route('**/api/games', (route) =>
    route.fulfill({
      json: Array.from({ length: 50 }, (_, index) =>
        game({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          modelProfileId: 'long-profile-'.repeat(12),
        }),
      ),
    }),
  );
  for (const path of ['/', '/history', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [844, 390],
      [683, 384],
      [768, 1024],
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width: width!, height: height! });
      await expect
        .poll(() =>
          page.evaluate(() => ({
            width: document.documentElement.scrollWidth <= innerWidth,
            height: document.documentElement.scrollHeight <= innerHeight,
            top: window.scrollY,
          })),
        )
        .toEqual({ width: true, height: true, top: 0 });
      await expect(
        page.getByRole('navigation', { name: 'Primary navigation' }),
      ).toBeInViewport();
      const region = page.getByRole('region', {
        name:
          path === '/'
            ? 'About this game'
            : path === '/history'
              ? 'Game archive'
              : 'Settings fields',
        exact: true,
      });
      await expect(region).toBeVisible();
      const overflow = await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {
          needed: element.scrollHeight > element.clientHeight + 1,
          top: element.scrollTop,
        };
      });
      if (overflow.needed) expect(overflow.top).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      if (path === '/')
        await expect(
          page.getByRole('button', { name: 'New Game', exact: true }),
        ).toBeInViewport();
      if (path === '/settings')
        await expect(
          page.getByRole('button', { name: 'Save settings' }),
        ).toBeInViewport();
      if (path === '/history')
        await expect(
          region.getByRole('link', { name: 'Resume game' }).last(),
        ).toBeInViewport();
    }
  }
});

test('keeps settings usable with keyboard, validation, errors, and zoom', async ({
  page,
}) => {
  await page.setViewportSize({ width: 683, height: 384 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openFixture(page, game({ currentFen: startingFen }));
  let saves = 0;
  let stored = settings;
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: stored });
    saves++;
    if (saves === 1)
      return route.fulfill({
        status: 500,
        json: {
          type: 'about:blank',
          requestId: 'responsive-test',
          title: 'Save failed',
          status: 500,
          detail: 'Long error detail. '.repeat(100),
        },
      });
    stored = route.request().postDataJSON() as typeof settings;
    return route.fulfill({ json: stored });
  });
  await page.goto('/settings');
  const region = page.getByRole('region', { name: 'Settings fields' });
  await region.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Preferred side')).toBeFocused();
  await page.getByLabel('Model profile').selectOption('qwen3-1.7b-q4-k-m');
  await expect(
    page.getByText('Restart the model to apply this profile.'),
  ).toBeVisible();
  const candidate = page.getByLabel('Candidate limit');
  await candidate.fill('9');
  const save = page.getByRole('button', { name: 'Save settings' });
  await save.click();
  await expect(candidate).toBeFocused();
  await expect(candidate).toBeInViewport();
  expect(saves).toBe(0);
  await candidate.fill('3');
  await save.click();
  await expect(page.getByText('Save failed')).toBeInViewport();
  await region.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(save).toBeInViewport();
  await save.click();
  await expect(page.getByText('Settings saved.')).toBeInViewport();
  expect(stored.stockfishCandidateLimit).toBe(3);
  expect(
    await page.evaluate(() => ({
      top: scrollY,
      width: document.documentElement.scrollWidth <= innerWidth,
      height: document.documentElement.scrollHeight <= innerHeight,
    })),
  ).toEqual({ top: 0, width: true, height: true });
});

test('bounds loading, empty, and long service-error states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFixture(page, game({ currentFen: startingFen }));
  await page.route('**/api/health', (route) => route.abort());
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/games', async (route) => {
    await loaded;
    await route.fulfill({ json: [] });
  });
  await page.goto('/history');
  await expect(page.getByText('Loading game history…')).toBeVisible();
  release();
  await expect(page.getByText('No games in progress.')).toBeVisible();
  for (const [path, api, label] of [
    ['/history', '**/api/games', 'History error'],
    ['/settings', '**/api/settings', 'Settings error'],
  ]) {
    await page.route(api!, (route) =>
      route.fulfill({
        status: 500,
        json: {
          type: 'about:blank',
          requestId: 'responsive-test',
          title: 'Service failure',
          status: 500,
          detail: 'Long-service-error-'.repeat(250),
        },
      }),
    );
    await page.goto(path!);
    const region = page.getByRole('region', { name: label! });
    await expect(region).toBeVisible();
    await region.focus();
    await page.keyboard.press('End');
    await expect
      .poll(() => region.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() => ({
        top: scrollY,
        width: document.documentElement.scrollWidth <= innerWidth,
        height: document.documentElement.scrollHeight <= innerHeight,
      })),
    ).toEqual({ top: 0, width: true, height: true });
    expect(
      await region.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
});
