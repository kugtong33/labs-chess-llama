import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { GameView, Promotion, Square } from '@chess-llama/contracts';

import { GatewayProblemError } from '../api/client.js';
import {
  gatewayKeys,
  useGame,
  useDecisions,
  useGateway,
  useHealth,
  useSettings,
} from '../api/queries.js';
import { AiCommentary } from '../components/ai-commentary.js';
import { DecisionPipeline } from '../components/decision-pipeline.js';
import { useDecisionEvents } from '../api/decision-events.js';
import { GameActions } from '../components/game-actions.js';
import { GameBoard } from '../components/game-board.js';
import { MoveList } from '../components/move-list.js';
import { ProblemBanner } from '../components/problem-banner.js';
import { saveBrowserDownload, useAbortScope } from './abort-scope.js';

export function PlayRoute() {
  const { id = '' } = useParams();
  const gateway = useGateway();
  const health = useHealth();
  const settings = useSettings();
  const gameQuery = useGame(id);
  const decisionsQuery = useDecisions(id);
  const decisionEvents = useDecisionEvents(
    id ? gateway.decisionEventsUrl(id) : '',
    { enabled: id.length > 0 },
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const abortable = useAbortScope();
  const [failure, setFailure] = useState<unknown>();
  const [announcement, setAnnouncement] = useState('');
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(
    null,
  );
  const modelStatus = health.data?.components.model.status;
  const modelReady = modelStatus === 'ready';

  const acceptGame = (next: GameView) => {
    setFailure(undefined);
    queryClient.setQueryData(gatewayKeys.game(next.id), next);
    void queryClient.invalidateQueries({
      queryKey: gatewayKeys.games(),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: gatewayKeys.decisions(next.id),
      exact: true,
    });
  };
  const handleFailure = (error: unknown) => {
    if (isAbort(error)) return;
    if (error instanceof GatewayProblemError && error.status === 409) {
      setAnnouncement('The game was refreshed because it changed elsewhere.');
      void queryClient.refetchQueries({
        queryKey: gatewayKeys.game(id),
        exact: true,
      });
      return;
    }
    setFailure(error);
    if (
      error instanceof GatewayProblemError &&
      error.gameStatus === 'awaiting_ai'
    ) {
      void queryClient.refetchQueries({
        queryKey: gatewayKeys.game(id),
        exact: true,
      });
    }
  };

  const create = useMutation({
    mutationFn: () => {
      const humanColor = settings.data?.preferredHumanColor;
      if (!humanColor) throw new Error('Settings are not loaded');
      return abortable((signal) => gateway.createGame({ humanColor }, signal));
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
        gateway.submitHumanMove(
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
        gateway.retryAiMove(
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
        gateway.resignGame(
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
      return abortable((signal) => gateway.getPgn(current.id, signal));
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
    <section className="play-workspace" aria-labelledby="game-title">
      <div className="play-heading">
        <div>
          <p className="eyebrow">Local match</p>
          <h1 id="game-title">Your game</h1>
        </div>
        <p className="turn-status" aria-live="polite">
          {turnMessage}
        </p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
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
      <ProblemBanner
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
          <AiCommentary
            decision={selectedDecision}
            backend={runtimeModel?.backend}
          />
          <DecisionPipeline
            events={decisionEvents.events}
            decision={selectedDecision}
            connection={decisionEvents.connection}
          />
          <MoveList
            moves={current.moves}
            decisions={decisions}
            selectedDecisionId={selectedDecision?.id}
            onSelectDecision={(decision) => {
              setSelectedDecisionId(decision.id);
              setAnnouncement(
                `Showing AI decision for move ${decision.chosenUci}.`,
              );
            }}
          />
        </div>
      </div>
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
