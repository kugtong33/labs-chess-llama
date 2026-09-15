// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../app.js';
import { fakeGateway, game } from '../test/fixtures.js';

afterEach(cleanup);

describe('History route', () => {
  it('separates resumable and completed games and downloads PGN', async () => {
    const user = userEvent.setup();
    const active = game({ updatedAt: '2026-09-15T02:00:00.000Z' });
    const completed = game({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'completed',
      result: '1-0',
      completedAt: '2026-09-15T01:00:00.000Z',
      updatedAt: '2026-09-15T01:00:00.000Z',
    });
    const getPgn = vi.fn(() =>
      Promise.resolve({ blob: new Blob(['1. e4 *']), filename: 'game.pgn' }),
    );
    render(
      <App
        gateway={fakeGateway({
          listGames: () => Promise.resolve([completed, active]),
          getPgn,
        })}
        initialEntries={['/history']}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Resume' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Resume game' })).toHaveAttribute(
      'href',
      `/games/${active.id}`,
    );
    await user.click(screen.getByRole('button', { name: 'Download PGN' }));
    expect(getPgn).toHaveBeenCalledWith(completed.id, expect.any(AbortSignal));
  });
});
