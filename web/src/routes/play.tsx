import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { GameView, Promotion, Square } from '@chess-llama/contracts';

import { BackendProblemError } from '../api/backend.js';
import {
  backendKeys,
  useGame,
  useDecisions,
  useBackend,
  useHealth,
  useSettings,
} from '../api/queries.js';
import { AiCommentary } from '../components/ai-commentary.js';
import { DecisionPipeline } from '../components/decision-pipeline.js';
import { useDecisionEvents } from '../api/decision-events.js';
import { GameDetails } from '../components/game-details.js';
import { GameActions } from '../components/game-actions.js';
import { GameBoard } from '../components/game-board.js';
import { MoveList } from '../components/move-list.js';
import { ProblemBanner } from '../components/problem-banner.js';
import { saveBrowserDownload, useAbortScope } from './abort-scope.js';

export function PlayRoute() {
  const { id = '' } = useParams();
  const backend = useBackend();
  const health = useHealth();
  const settings = useSettings();
  const gameQuery = useGame(id);
  const decisionsQuery = useDecisions(id);
  const decisionEvents = useDecisionEvents(
    id ? backend.decisionEventsUrl(id) : '',
    { enabled: id.length > 0 },
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const abortable = useAbortScope();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'Moves' | 'AI' | 'Pipeline'>('AI');
  const workspace = useRef<HTMLElement>(null);
  const focusAfterRender = useRef<'details' | 'back' | 'ai' | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const [failure, setFailure] = useState<unknown>();
  const [announcement, setAnnouncement] = useState('');
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(
    null,
  );
  useLayoutEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    if (target === 'back') backButton.current?.focus();
    else if (target === 'details') detailsButton.current?.focus();
    else
      workspace.current
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
  }, [detailsOpen, detailTab, selectedDecisionId]);

  useEffect(() => {
    setDetailsOpen(false);
    setDetailTab('AI');
    setSelectedDecisionId(null);
  }, [id]);

  useEffect(() => {
    const compact = window.matchMedia?.(
      '(max-width: 899px), (max-height: 599px)',
    );
    if (!compact?.addEventListener) return;
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement)
        lastFocused.current = event.target;
    };
    const keepFocusVisible = () => {
      const focused = lastFocused.current;
      if (
        !focused ||
        !workspace.current?.contains(focused) ||
        focused.getClientRects().length
      )
        return;
      if (
        document.activeElement !== document.body &&
        document.activeElement !== focused
      )
        return;
      if (compact.matches) {
        (detailsOpen ? backButton.current : detailsButton.current)?.focus();
      } else {
        workspace.current
          .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?.focus();
      }
    };
    document.addEventListener('focusin', rememberFocus);
    compact.addEventListener('change', keepFocusVisible);
    return () => {
      document.removeEventListener('focusin', rememberFocus);
      compact.removeEventListener('change', keepFocusVisible);
    };
  }, [detailsOpen]);

  const modelStatus = health.data?.components.model.status;
  const modelReady = modelStatus === 'ready';

  const acceptGame = (next: GameView) => {
    setFailure(undefined);
    queryClient.setQueryData(backendKeys.game(next.id), next);
    void queryClient.invalidateQueries({
      queryKey: backendKeys.games(),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: backendKeys.decisions(next.id),
      exact: true,
    });
  };
  const handleFailure = (error: unknown) => {
    if (isAbort(error)) return;
    if (error instanceof BackendProblemError && error.status === 409) {
      setAnnouncement('The game was refreshed because it changed elsewhere.');
      void queryClient.refetchQueries({
        queryKey: backendKeys.game(id),
        exact: true,
      });
      return;
    }
    setFailure(error);
    if (
      error instanceof BackendProblemError &&
      error.gameStatus === 'awaiting_ai'
    ) {
      void queryClient.refetchQueries({
        queryKey: backendKeys.game(id),
        exact: true,
      });
    }
  };

  const create = useMutation({
    mutationFn: () => {
      const humanColor = settings.data?.preferredHumanColor;
      if (!humanColor) throw new Error('Settings are not loaded');
      return abortable((signal) => backend.createGame({ humanColor }, signal));
    },
    onSuccess: (next) => {
      acceptGame(next);
      void navigate(`/games/${next.id}`);
    },
    onError: handleFailure,
  });
  const humanMove = useMutation({
    mutationFn: (move: { from: Square; to: Square; promotion?: Promotion }) => {
      const current = gameQuery.data;
      if (!current) throw new Error('Game is not loaded');
      return abortable((signal) =>
        backend.submitHumanMove(
          current.id,
          { ...move, expectedPly: current.moves.length },
          signal,
        ),
      );
    },
    onSuccess: acceptGame,
    onError: handleFailure,
  });
  const retryAi = useMutation({
    mutationFn: () => {
      const current = gameQuery.data;
      if (!current) throw new Error('Game is not loaded');
      return abortable((signal) =>
        backend.retryAiMove(
          current.id,
          { expectedPly: current.moves.length },
          signal,
        ),
      );
    },
    onSuccess: acceptGame,
    onError: handleFailure,
  });
  const resign = useMutation({
    mutationFn: () => {
      const current = gameQuery.data;
      if (!current) throw new Error('Game is not loaded');
      return abortable((signal) =>
        backend.resignGame(
          current.id,
          { expectedPly: current.moves.length },
          signal,
        ),
      );
    },
    onSuccess: acceptGame,
    onError: handleFailure,
  });
  const download = useMutation({
    mutationFn: () => {
      const current = gameQuery.data;
      if (!current) throw new Error('Game is not loaded');
      return abortable((signal) => backend.getPgn(current.id, signal));
    },
    onSuccess: ({ blob, filename }) => saveBrowserDownload(blob, filename),
    onError: handleFailure,
  });

  if (!id) {
    return (
      <section className="hero" aria-labelledby="play-title">
        <p className="eyebrow">Your machine. Your model. Your move.</p>
        <h1 id="play-title">Play chess with a local language model.</h1>
        <p className="hero-copy">
          Stockfish finds credible candidates. llama.cpp chooses a move and
          tells you why—without sending your game anywhere.
        </p>
        <button
          className="button primary large"
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending || !settings.data || !modelReady}
        >
          {create.isPending ? 'Starting game…' : 'New Game'}
        </button>
        <p className="disclosure hero-disclosure">
          Stockfish suggests candidates; Qwen via llama.cpp chooses and
          explains.
        </p>
        <ProblemBanner
          compact
          error={failure}
          onReconnect={() => {
            void health.refetch();
          }}
        />
      </section>
    );
  }

  if (gameQuery.isPending) return <RouteLoading label="Loading game…" />;
  if (!gameQuery.data) {
    return (
      <ProblemBanner
        compact
        error={gameQuery.error ?? new Error('Game not found')}
        onReconnect={() => {
          void gameQuery.refetch();
        }}
      />
    );
  }

  const current = gameQuery.data;
  const decisions =
    decisionsQuery.data ??
    (current.lastAiDecision ? [current.lastAiDecision] : []);
  const selectedDecision =
    decisions.find((decision) => decision.id === selectedDecisionId) ??
    current.lastAiDecision;
  const replayingDecision =
    selectedDecision !== null &&
    selectedDecision.id !== current.lastAiDecision?.id;
  const runtimeModel = health.data?.components.model;
  const pending = [create, humanMove, retryAi, resign, download].some(
    (mutation) => mutation.isPending,
  );
  const turnColor = current.moves.length % 2 === 0 ? 'white' : 'black';
  const humanTurn =
    current.status === 'active' && turnColor === current.humanColor;
  const boardDisabled = !humanTurn || pending || !modelReady;
  const turnMessage = statusMessage(current, modelStatus, pending);

  return (
    <section
      ref={workspace}
      className={`play-workspace${detailsOpen ? ' details-open' : ''}`}
      aria-labelledby="game-title"
    >
      <div className="play-heading">
        <div>
          <h1 id="game-title">Your game</h1>
        </div>
        <p className="turn-status" aria-live="polite">
          {turnMessage}
        </p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <ProblemBanner
        compact
        error={failure ?? gameQuery.error ?? health.error}
        onReconnect={() => {
          setFailure(undefined);
          void Promise.all([health.refetch(), gameQuery.refetch()]);
        }}
      />
      <div className="game-grid">
        <GameBoard
          key={current.id}
          fen={current.currentFen}
          orientation={settings.data?.boardOrientation ?? current.humanColor}
          humanColor={current.humanColor}
          disabled={boardDisabled}
          onMove={(from, to, promotion) => {
            setFailure(undefined);
            humanMove.mutate({ from, to, ...(promotion ? { promotion } : {}) });
          }}
        />
        <div className="game-sidebar">
          <button
            ref={backButton}
            type="button"
            className="button secondary back-to-game"
            onClick={() => {
              focusAfterRender.current = 'details';
              setDetailsOpen(false);
            }}
          >
            Back to game
          </button>
          <GameDetails
            key={current.id}
            decisionId={selectedDecision?.id}
            selectedTab={detailTab}
            onSelectTab={setDetailTab}
            ai={
              <>
                <AiCommentary
                  decision={selectedDecision}
                  backend={runtimeModel?.backend}
                />
                <dl className="runtime-metadata" aria-label="Loaded AI runtime">
                  <div>
                    <dt>Model</dt>
                    <dd>{runtimeModel?.modelId ?? 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>Profile</dt>
                    <dd>{runtimeModel?.profileId ?? current.modelProfileId}</dd>
                  </div>
                  <div>
                    <dt>Quantization</dt>
                    <dd>{runtimeModel?.quantization ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Backend</dt>
                    <dd>{runtimeModel?.backend ?? '—'}</dd>
                  </div>
                </dl>
              </>
            }
            pipeline={
              <DecisionPipeline
                events={decisionEvents.events}
                decision={selectedDecision}
                connection={decisionEvents.connection}
                replay={replayingDecision}
              />
            }
            moves={
              <MoveList
                moves={current.moves}
                decisions={decisions}
                selectedDecisionId={selectedDecision?.id}
                onSelectDecision={(decision) => {
                  focusAfterRender.current = 'ai';
                  setSelectedDecisionId(decision.id);
                  setDetailTab('AI');
                  setAnnouncement(
                    `Showing AI decision for move ${decision.chosenUci}.`,
                  );
                }}
              />
            }
          />
        </div>
      </div>
      <div className="game-toolbar">
        <button
          ref={detailsButton}
          type="button"
          className="button secondary show-details"
          onClick={() => {
            focusAfterRender.current = 'back';
            setDetailsOpen(true);
          }}
        >
          Details
        </button>
        <GameActions
          canCreate={Boolean(settings.data) && modelReady}
          canResign={current.status !== 'completed'}
          canRetry={current.status === 'awaiting_ai' && modelReady}
          pending={pending}
          onNewGame={() => create.mutate()}
          onResign={() => resign.mutate()}
          onRetry={() => retryAi.mutate()}
          onDownload={() => download.mutate()}
        />
      </div>
    </section>
  );
}

function RouteLoading({ label }: { label: string }) {
  return (
    <p className="route-loading" role="status">
      {label}
    </p>
  );
}

function statusMessage(
  game: GameView,
  modelStatus: 'ready' | 'loading' | 'unavailable' | undefined,
  pending: boolean,
): string {
  if (game.status === 'completed') return `Game over · ${game.result}`;
  if (modelStatus === 'loading')
    return 'Model is loading — the board is paused.';
  if (modelStatus !== 'ready')
    return 'Model unavailable — start it to continue.';
  if (pending) return 'AI is thinking…';
  if (game.status === 'awaiting_ai')
    return 'AI move paused — retry when ready.';
  return 'Your move';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
