import type { LegalMove } from '@chess-llama/chess-domain';
import type { EngineScore } from '@chess-llama/contracts';

export interface ParsedInfo {
  rank: number;
  uci: string;
  score: EngineScore;
}

export interface RankedCandidate {
  rank: number;
  uci: string;
  san: string;
  score: EngineScore;
  normalizedScore: number;
}

export interface AnalysisRequest {
  fen: string;
  legalMoves: readonly LegalMove[];
  candidateLimit: number;
  moveTimeMs: number;
  maxLossCp: number;
  signal?: AbortSignal;
}

export interface StockfishAnalyzer {
  analyze(request: AnalysisRequest): Promise<RankedCandidate[]>;
  close(): Promise<void>;
}
