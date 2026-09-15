import type { EngineScore } from '@chess-llama/contracts';

import { normalizeScore } from './uci-parser.js';
import type { ParsedInfo, RankedCandidate } from './types.js';

export interface UnrankedCandidate {
  rank: number;
  uci: string;
  san: string;
  score: EngineScore;
}

export function filterCredibleCandidates(
  candidates: readonly UnrankedCandidate[],
  maxLossCp: number,
): RankedCandidate[] {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      normalizedScore: normalizeScore(candidate.score),
    }))
    .sort((left, right) => left.rank - right.rank);
  const best = ranked[0];
  if (best === undefined) return [];

  return ranked.filter(
    (candidate) =>
      candidate.rank === 1 ||
      best.normalizedScore - candidate.normalizedScore <= maxLossCp,
  );
}

export function joinLegalMoves(
  parsed: readonly ParsedInfo[],
  legalMoves: readonly { uci: string; san: string }[],
): UnrankedCandidate[] {
  const byUci = new Map(legalMoves.map((move) => [move.uci, move.san]));
  return parsed.flatMap((candidate) => {
    const san = byUci.get(candidate.uci);
    return san === undefined ? [] : [{ ...candidate, san }];
  });
}
