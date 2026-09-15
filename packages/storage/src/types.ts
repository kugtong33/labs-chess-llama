import type {
  AiDecisionView,
  CandidateView,
  Color,
  GameResult,
  GameStatus,
  MoveActor,
  Settings,
  Uci,
} from '@chess-llama/contracts';

export interface PersistableMove {
  id: string;
  ply: number;
  color: Color;
  actor: MoveActor;
  uci: Uci;
  san: string;
  fenAfter: string;
  pgnAfter: string;
  createdAt?: number;
}

export type PersistableAiDecision = Omit<
  AiDecisionView,
  'id' | 'gameId' | 'moveId' | 'createdAt'
> & {
  id?: string;
  moveId?: string;
  createdAt?: number;
};

export interface StoredAiDecision {
  id: string;
  moveId: string;
  candidates: CandidateView[];
  chosenUci: Uci;
  commentary: string;
  modelId: string;
  profileId: string;
  quantization: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  tokensPerSecond: number | null;
  retryCount: 0 | 1;
  createdAt: number;
}

export interface StoredMove extends Omit<PersistableMove, 'pgnAfter'> {
  pgnAfter?: string;
  createdAt: number;
}

export interface GameAggregate {
  id: string;
  status: GameStatus;
  humanColor: Color;
  currentFen: string;
  pgn: string;
  result: GameResult;
  modelProfileId: string;
  moves: StoredMove[];
  lastAiDecision: StoredAiDecision | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export type { Settings };
