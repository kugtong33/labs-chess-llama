// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../app.js';
import { fakeGateway, readyHealth, settings } from '../test/fixtures.js';

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

describe('Settings route', () => {
  it('saves bounded settings and explains profile restart behavior', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn((request) =>
      Promise.resolve({ ...settings, ...request }),
    );
    render(
      <App
        gateway={fakeGateway({ updateSettings })}
        initialEntries={['/settings']}
      />,
    );

    const candidates = await screen.findByLabelText('Candidate limit');
    const moveTime = screen.getByLabelText('Stockfish move time (ms)');
    expect(candidates).toHaveAttribute('min', '1');
    expect(candidates).toHaveAttribute('max', '5');
    expect(moveTime).toHaveAttribute('min', '25');
    expect(moveTime).toHaveAttribute('max', '1000');
    candidates.focus();
    await user.tab();
    expect(moveTime).toHaveFocus();

    await user.selectOptions(
      screen.getByLabelText('Model profile'),
      'qwen3-1.7b-q4-k-m',
    );
    expect(
      screen.getByText(/Restart the model to apply this profile/u),
    ).toBeVisible();
    expect(
      screen.getByText(/chess-llama model start --profile qwen3-1.7b-q4-k-m/u),
    ).toBeVisible();

    await user.clear(candidates);
    await user.type(candidates, '3');
    await user.clear(moveTime);
    await user.type(moveTime, '250');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProfileId: 'qwen3-1.7b-q4-k-m',
        stockfishCandidateLimit: 3,
        stockfishMoveTimeMs: 250,
      }),
      expect.any(AbortSignal),
    );
  });

  it('compares saved settings with the profile actually loaded by llama.cpp', async () => {
    render(
      <App
        gateway={fakeGateway({
          getSettings: () =>
            Promise.resolve({
              ...settings,
              modelProfileId: 'qwen3-1.7b-q4-k-m',
            }),
          health: () => Promise.resolve(readyHealth),
        })}
        initialEntries={['/settings']}
      />,
    );

    expect(
      await screen.findByText(/Restart the model to apply this profile/u),
    ).toBeVisible();
  });

  it('shows restart guidance for profile changes while runtime health is unknown', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn((request) =>
      Promise.resolve({ ...settings, ...request }),
    );
    render(
      <App
        gateway={fakeGateway({
          health: () => new Promise(() => undefined),
          updateSettings,
        })}
        initialEntries={['/settings']}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText('Model profile'),
      'qwen3-1.7b-q4-k-m',
    );
    expect(
      screen.getByText(/Restart the model to apply this profile/u),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      await screen.findByText(/Restart the model to apply this profile/u),
    ).toBeVisible();
  });

  it('applies only the persisted theme across non-settings routes', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn((request) =>
      Promise.resolve({ ...settings, ...request }),
    );
    render(
      <App
        gateway={fakeGateway({
          getSettings: () => Promise.resolve({ ...settings, theme: 'dark' }),
          updateSettings,
        })}
        initialEntries={['/settings']}
      />,
    );

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark'),
    );
    await user.selectOptions(screen.getByLabelText('Theme'), 'light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('link', { name: 'Play' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
