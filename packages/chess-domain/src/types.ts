import type {
  Color,
  GameResult,
  Promotion,
  Square,
  SubmitMoveRequest,
  Uci,
} from '@chess-llama/contracts';

export type HumanMoveInput = Pick<
  SubmitMoveRequest,
  'from' | 'to' | 'promotion'
>;

export interface UciMove {
  uci: Uci;
}

export interface LegalMove {
  uci: Uci;
  san: string;
  from: Square;
  to: Square;
  promotion?: Promotion;
}

export interface AppliedMove extends LegalMove {
  color: Color;
  fenAfter: string;
  pgnAfter: string;
  gameOver: boolean;
  result: GameResult;
}

export class InvalidMoveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidMoveError';
  }
}
