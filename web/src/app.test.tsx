// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BackendApi } from './api/backend.js';
import { App } from './app.js';

const health = {
  status: 'degraded' as const,
  components: {
    backend: { status: 'ready' as const },
    database: { status: 'ready' as const },
    stockfish: { status: 'ready' as const },
    model: {
      status: 'unavailable' as const,
      detail: 'Model is offline',
      modelId: null,
      profileId: null,
      quantization: null,
      backend: null,
    },
  },
};

function createFakeBackend(): BackendApi {
  const unused = () => Promise.reject(new Error('not used by shell test'));
  return {
    health: () => Promise.resolve(health),
    listGames: () => Promise.resolve([]),
    getGame: unused,
    getDecisions: unused,
    decisionEventsUrl: () => '/api/demo/events',
    createGame: unused,
    submitHumanMove: unused,
    retryAiMove: unused,
    resignGame: unused,
    getSettings: () =>
      Promise.resolve({
        preferredHumanColor: 'white',
        boardOrientation: 'white',
        theme: 'system',
        commentaryStyle: 'concise',
        modelProfileId: 'qwen3-4b-q4-k-m',
        stockfishCandidateLimit: 5,
        stockfishMoveTimeMs: 100,
      }),
    updateSettings: unused,
    getPgn: unused,
  };
}

afterEach(cleanup);

describe('App', () => {
  it('renders navigation and degraded runtime guidance', async () => {
    render(<App backend={createFakeBackend()} initialEntries={['/']} />);

    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Play' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'History' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
    expect(await screen.findByText(/chess-llama model start/u)).toBeVisible();
  });

  it('provides all approved shell routes', async () => {
    const backend = createFakeBackend();
    const { unmount } = render(
      <App backend={backend} initialEntries={['/history']} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'History' }),
    ).toBeVisible();
    unmount();

    render(<App backend={backend} initialEntries={['/settings']} />);
    expect(
      await screen.findByRole('heading', { name: 'Settings' }),
    ).toBeVisible();
  });
});
