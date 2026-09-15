// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../app.js';
import { fakeGateway, settings } from '../test/fixtures.js';

afterEach(cleanup);

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
});
