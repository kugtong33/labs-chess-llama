// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ChessboardOptions } from 'react-chessboard';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayConnectionError, GatewayProblemError } from '../api/client.js';
import { App } from '../app.js';
import {
  fakeGateway,
  game,
  gameAfterTurn,
  gameId,
  readyHealth,
  settings,
} from '../test/fixtures.js';

const board = vi.hoisted(() => ({
  options: undefined as ChessboardOptions | undefined,
  lastDropResult: undefined as boolean | undefined,
}));

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options?: ChessboardOptions }) => {
    board.options = options;
    const drop = (sourceSquare: string, targetSquare: string | null) => {
      board.lastDropResult = options?.onPieceDrop?.({
        piece: {
          pieceType: 'wP',
          position: sourceSquare,
          isSparePiece: false,
        },
        sourceSquare,
        targetSquare,
      });
    };
    return (
      <div aria-label="Chessboard">
        <button
          type="button"
          disabled={!options?.allowDragging}
          onClick={() => drop('e2', 'e4')}
        >
          Move e2 to e4
        </button>
        <button type="button" onClick={() => drop('e2', null)}>
          Illegal drop
        </button>
        <button type="button" onClick={() => drop('e7', 'e8')}>
          Promote pawn
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  board.options = undefined;
  board.lastDropResult = undefined;
  vi.unstubAllGlobals();
});

describe('Play route', () => {
  it('submits an authoritative move and renders the AI decision', async () => {
    const user = userEvent.setup();
    const submitHumanMove = vi.fn(() => Promise.resolve(gameAfterTurn()));
    render(
      <App
        gateway={fakeGateway({ submitHumanMove })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Move e2 to e4' }),
    );

    expect(submitHumanMove).toHaveBeenCalledWith(
      gameId,
      { from: 'e2', to: 'e4', expectedPly: 0 },
      expect.any(AbortSignal),
    );
    expect(await screen.findByText('I challenge your center.')).toBeVisible();
    expect(screen.getByText(/Qwen3-4B · Q4_K_M/u)).toBeVisible();
    expect(
      screen.getByText(
        'Stockfish suggests candidates; Qwen via llama.cpp chooses and explains.',
      ),
    ).toBeVisible();
  });

  it('offers an AI retry without replaying the human move', async () => {
    const user = userEvent.setup();
    const paused = gameAfterTurnWith({
      status: 'awaiting_ai',
      moves: [gameAfterTurn().moves[0]!],
    });
    const retryFailure = new GatewayProblemError({
      type: 'model-unavailable',
      title: 'Model unavailable',
      status: 503,
      detail: 'llama.cpp stopped during the turn',
      requestId: 'req-retry',
      gameId,
      gameStatus: 'awaiting_ai',
    });
    const retryAiMove = vi
      .fn()
      .mockRejectedValueOnce(retryFailure)
      .mockResolvedValueOnce(gameAfterTurn());
    render(
      <App
        gateway={fakeGateway({
          getGame: () => Promise.resolve(paused),
          retryAiMove,
        })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Retry AI move' }),
    );

    expect(await screen.findByText(retryFailure.detail)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry AI move' }));

    expect(retryAiMove).toHaveBeenLastCalledWith(
      gameId,
      { expectedPly: 1 },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(screen.queryByText(retryFailure.detail)).not.toBeInTheDocument(),
    );
  });

  it('asks for promotion and ignores an invalid drop', async () => {
    const user = userEvent.setup();
    const submitHumanMove = vi.fn(() => Promise.resolve(gameAfterTurn()));
    render(
      <App
        gateway={fakeGateway({ submitHumanMove })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );
    await screen.findByLabelText('Chessboard');

    await user.click(screen.getByRole('button', { name: 'Illegal drop' }));
    expect(submitHumanMove).not.toHaveBeenCalled();
    expect(board.lastDropResult).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Promote pawn' }));
    await user.click(screen.getByRole('button', { name: 'Promote to queen' }));

    expect(submitHumanMove).toHaveBeenCalledWith(
      gameId,
      { from: 'e7', to: 'e8', promotion: 'q', expectedPly: 0 },
      expect.any(AbortSignal),
    );
  });

  it('discards a pending promotion when the board becomes locked', async () => {
    const user = userEvent.setup();
    const resignGame = vi.fn(
      () => new Promise<ReturnType<typeof game>>(() => undefined),
    );
    const submitHumanMove = vi.fn(() => Promise.resolve(gameAfterTurn()));
    render(
      <App
        gateway={fakeGateway({ resignGame, submitHumanMove })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Promote pawn' }),
    );
    expect(screen.getByLabelText('Choose promotion')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Resign' }));

    await waitFor(() =>
      expect(
        screen.queryByLabelText('Choose promotion'),
      ).not.toBeInTheDocument(),
    );
    expect(submitHumanMove).not.toHaveBeenCalled();
  });

  it('disables play while the model loads and after checkmate', async () => {
    const loading = {
      ...readyHealth,
      status: 'loading' as const,
      components: {
        ...readyHealth.components,
        model: { ...readyHealth.components.model, status: 'loading' as const },
      },
    };
    const { unmount } = render(
      <App
        gateway={fakeGateway({ health: () => Promise.resolve(loading) })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'Move e2 to e4' }),
    ).toBeDisabled();
    expect(screen.getByText(/Model is loading/u)).toBeVisible();
    unmount();

    render(
      <App
        gateway={fakeGateway({
          getGame: () =>
            Promise.resolve(
              game({
                status: 'completed',
                result: '1-0',
                completedAt: '2026-09-15T01:00:00.000Z',
              }),
            ),
        })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );
    expect(await screen.findByText(/Game over · 1-0/u)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Move e2 to e4' }),
    ).toBeDisabled();
  });

  it('disables board animation when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    render(
      <App gateway={fakeGateway()} initialEntries={[`/games/${gameId}`]} />,
    );

    await screen.findByLabelText('Chessboard');
    expect(board.options?.showAnimations).toBe(false);
    expect(board.options?.animationDurationInMs).toBe(0);
  });

  it('aborts a move on navigation and refreshes stale 409 state', async () => {
    const user = userEvent.setup();
    let moveSignal: AbortSignal | undefined;
    const pendingMove = vi.fn((_id, _request, signal?: AbortSignal) => {
      moveSignal = signal;
      return new Promise<ReturnType<typeof game>>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () =>
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error('Move aborted'),
            ),
          { once: true },
        );
      });
    });
    const first = render(
      <App
        gateway={fakeGateway({ submitHumanMove: pendingMove })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Move e2 to e4' }),
    );
    first.unmount();
    expect(moveSignal?.aborted).toBe(true);

    const getGame = vi.fn(() => Promise.resolve(game()));
    const stale = new GatewayProblemError({
      type: 'stale-ply',
      title: 'Stale game',
      status: 409,
      detail: 'Expected ply is stale',
      requestId: 'req-stale',
      gameId,
      gameStatus: 'active',
    });
    render(
      <App
        gateway={fakeGateway({
          getGame,
          submitHumanMove: () => Promise.reject(stale),
        })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Move e2 to e4' }),
    );
    expect(await screen.findByText(/game was refreshed/u)).toBeVisible();
    await waitFor(() => expect(getGame).toHaveBeenCalledTimes(2));
  });

  it('retains the last authoritative board when a background refetch fails', async () => {
    const user = userEvent.setup();
    const stale = new GatewayProblemError({
      type: 'stale-ply',
      title: 'Stale game',
      status: 409,
      detail: 'Expected ply is stale',
      requestId: 'req-stale-refetch',
      gameId,
      gameStatus: 'active',
    });
    const offline = new GatewayConnectionError('Gateway went offline');
    const getGame = vi
      .fn()
      .mockResolvedValueOnce(game())
      .mockRejectedValue(offline);
    render(
      <App
        gateway={fakeGateway({
          getGame,
          submitHumanMove: () => Promise.reject(stale),
        })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Move e2 to e4' }),
    );

    expect(await screen.findByText('Gateway went offline')).toBeVisible();
    expect(screen.getByLabelText('Chessboard')).toBeVisible();
  });

  it('waits for persisted settings and a ready model before creating a game', async () => {
    const user = userEvent.setup();
    let resolveSettings!: (value: typeof settings) => void;
    const pendingSettings = new Promise<typeof settings>((resolve) => {
      resolveSettings = resolve;
    });
    const createGame = vi.fn(() => Promise.resolve(game()));
    render(
      <App
        gateway={fakeGateway({
          getSettings: () => pendingSettings,
          createGame,
        })}
        initialEntries={['/']}
      />,
    );

    const button = await screen.findByRole('button', { name: 'New Game' });
    expect(button).toBeDisabled();
    resolveSettings({ ...settings, preferredHumanColor: 'black' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(createGame).toHaveBeenCalledWith(
      { humanColor: 'black' },
      expect.any(AbortSignal),
    );
  });

  it('resigns the current game', async () => {
    const user = userEvent.setup();
    const resignGame = vi.fn(() =>
      Promise.resolve(game({ status: 'completed', result: '0-1' })),
    );
    render(
      <App
        gateway={fakeGateway({ resignGame })}
        initialEntries={[`/games/${gameId}`]}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Resign' }));
    expect(resignGame).toHaveBeenCalledWith(
      gameId,
      { expectedPly: 0 },
      expect.any(AbortSignal),
    );
  });
});

function gameAfterTurnWith(
  overrides: Partial<ReturnType<typeof gameAfterTurn>>,
) {
  return { ...gameAfterTurn(), ...overrides };
}
