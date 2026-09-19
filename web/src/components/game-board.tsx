import { useEffect, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Color, Promotion, Square } from '@chess-llama/contracts';

interface PendingPromotion {
  from: Square;
  to: Square;
}

export interface GameBoardProps {
  fen: string;
  orientation: Color;
  humanColor: Color;
  disabled: boolean;
  onMove: (from: Square, to: Square, promotion?: Promotion) => void;
}

const squarePattern = /^[a-h][1-8]$/u;

export function GameBoard({
  fen,
  orientation,
  humanColor,
  disabled,
  onMove,
}: GameBoardProps) {
  const [promotion, setPromotion] = useState<PendingPromotion>();

  useEffect(() => {
    setPromotion(undefined);
  }, [disabled, fen]);

  return (
    <div className="board-panel">
      <div className="board-frame" aria-label="Game board">
        <Chessboard
          options={{
            id: 'chess-llama-board',
            position: fen,
            boardOrientation: orientation,
            allowDragging: !disabled,
            allowDrawingArrows: !disabled,
            showAnimations: !reducedMotion(),
            animationDurationInMs: reducedMotion() ? 0 : 180,
            darkSquareStyle: { backgroundColor: '#49664f' },
            lightSquareStyle: { backgroundColor: '#e7dfcd' },
            boardStyle: { borderRadius: '10px' },
            squareRenderer: ({ square, piece, children }) => (
              <div
                data-square={square}
                data-piece={piece?.pieceType ?? ''}
                style={{ width: '100%', height: '100%' }}
              >
                {children}
              </div>
            ),
            canDragPiece: ({ piece }) =>
              !disabled &&
              piece.pieceType.startsWith(humanColor === 'white' ? 'w' : 'b'),
            onPieceDrop: ({ piece, sourceSquare, targetSquare }) => {
              if (
                disabled ||
                !isSquare(sourceSquare) ||
                !isSquare(targetSquare)
              )
                return false;
              if (isPromotion(piece.pieceType, targetSquare)) {
                setPromotion({ from: sourceSquare, to: targetSquare });
              } else {
                onMove(sourceSquare, targetSquare);
              }
              // The backend response is authoritative; never keep local movement.
              return false;
            },
          }}
        />
      </div>
      {promotion ? (
        <div
          className="promotion-picker"
          role="group"
          aria-label="Choose promotion"
        >
          {(
            [
              ['q', 'queen'],
              ['r', 'rook'],
              ['b', 'bishop'],
              ['n', 'knight'],
            ] as const
          ).map(([piece, name]) => (
            <button
              key={piece}
              className="button secondary"
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                onMove(promotion.from, promotion.to, piece);
                setPromotion(undefined);
              }}
            >
              Promote to {name}
            </button>
          ))}
          <button
            className="button ghost"
            type="button"
            disabled={disabled}
            onClick={() => setPromotion(undefined)}
          >
            Cancel promotion
          </button>
        </div>
      ) : null}
    </div>
  );
}

function isSquare(value: string | null): value is Square {
  return value !== null && squarePattern.test(value);
}

function isPromotion(pieceType: string, target: Square): boolean {
  return pieceType.toLowerCase().endsWith('p') && /[18]$/u.test(target);
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
