import type { CommentaryStyle } from '@chess-llama/contracts';

export interface MoveCandidate {
  rank: number;
  uci: string;
  san: string;
}

export interface SelectMoveRequest {
  fen: string;
  sanHistory: readonly string[];
  candidates: readonly MoveCandidate[];
  commentaryStyle: CommentaryStyle;
  modelProfileId: string;
  signal?: AbortSignal;
}

export interface InferenceMetrics {
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  tokensPerSecond: number | null;
}

export interface MoveSelection extends InferenceMetrics {
  uci: string;
  commentary: string;
  modelId: string;
  retryCount: 0 | 1;
}

export interface ModelHealth {
  status: 'ready' | 'unavailable';
  modelId: string | null;
  profileId: string | null;
  quantization: string | null;
  backend: string | null;
  detail?: string;
}

export interface MoveSelector {
  health(signal?: AbortSignal): Promise<ModelHealth>;
  selectMove(request: SelectMoveRequest): Promise<MoveSelection>;
}

export interface LlamaCppClientOptions {
  baseUrl?: string;
  modelId?: string;
  profileId?: string;
  quantization?: string;
  backend?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
