import type { EngineScore } from '@chess-llama/contracts';

import type { ParsedInfo } from './types.js';

export function parseInfoLine(line: string): ParsedInfo | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info') return null;

  const multipvIndex = tokens.indexOf('multipv');
  const scoreIndex = tokens.indexOf('score');
  const pvIndex = tokens.indexOf('pv');
  if (scoreIndex < 0 || pvIndex < 0 || pvIndex + 1 >= tokens.length) {
    return null;
  }

  const scoreType = tokens[scoreIndex + 1];
  const scoreValue = Number(tokens[scoreIndex + 2]);
  if (
    (scoreType !== 'cp' && scoreType !== 'mate') ||
    !Number.isInteger(scoreValue)
  ) {
    return null;
  }

  const rank = multipvIndex >= 0 ? Number(tokens[multipvIndex + 1]) : 1;
  if (!Number.isInteger(rank) || rank < 1) return null;

  return {
    rank,
    uci: tokens[pvIndex + 1]!,
    score: { type: scoreType, value: scoreValue },
  };
}

export function parseInfoLines(lines: Iterable<string>): ParsedInfo[] {
  const latest = new Map<number, ParsedInfo>();
  for (const line of lines) {
    if (line.trimStart().startsWith('bestmove')) break;
    const parsed = parseInfoLine(line);
    if (parsed !== null) latest.set(parsed.rank, parsed);
  }
  return [...latest.values()].sort((left, right) => left.rank - right.rank);
}

export function normalizeScore(score: EngineScore): number {
  if (score.type === 'cp') return score.value;
  if (score.value === 0) return 0;
  return Math.sign(score.value) * (100_000 - Math.abs(score.value));
}
