// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { GatewayApi } from './api/client.js';
import { App } from './app.js';

const health = {
  status: 'degraded' as const,
  components: {
    gateway: { status: 'ready' as const },
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

function createFakeGateway(): GatewayApi {
  const unused = () => Promise.reject(new Error('not used by shell test'));
  return {
    health: () => Promise.resolve(health),
    listGames: unused,
    getGame: unused,
    createGame: unused,
    submitHumanMove: unused,
    retryAiMove: unused,
    resignGame: unused,
    getSettings: unused,
    updateSettings: unused,
    getPgn: unused,
  };
}

describe('App', () => {
  it('renders navigation and degraded runtime guidance', async () => {
    render(<App gateway={createFakeGateway()} initialEntries={['/']} />);

    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Play' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'History' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
    expect(await screen.findByText(/chess-llama model start/u)).toBeVisible();
  });

  it('provides all approved shell routes', async () => {
    const gateway = createFakeGateway();
    const { unmount } = render(
      <App gateway={gateway} initialEntries={['/history']} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'History' }),
    ).toBeVisible();
    unmount();

    render(<App gateway={gateway} initialEntries={['/settings']} />);
    expect(
      await screen.findByRole('heading', { name: 'Settings' }),
    ).toBeVisible();
  });
});
