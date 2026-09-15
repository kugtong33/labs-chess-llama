import type { CommentaryStyle } from '@chess-llama/contracts';

import type { MoveCandidate } from './types.js';

export interface PromptInput {
  fen: string;
  sanHistory: readonly string[];
  candidates: readonly MoveCandidate[];
  commentaryStyle: CommentaryStyle;
}

export function buildPrompt(input: PromptInput): string {
  const history = input.sanHistory.length
    ? input.sanHistory.join(' ')
    : '(start position)';
  const choices = input.candidates
    .map((candidate) => `${candidate.uci} (${candidate.san})`)
    .join(', ');

  return [
    '/no_think',
    'Stockfish already filtered these choices; select exactly one candidate.',
    `Position FEN: ${input.fen}`,
    `Recent SAN history: ${history}`,
    `Candidates (UCI (SAN)): ${choices}`,
    `Write one strategic sentence in a ${input.commentaryStyle} style.`,
    'Return JSON with exactly these keys: move and commentary.',
    'Do not claim a capture or check unless the SAN string supports it.',
  ].join('\n');
}

export function buildSystemPrompt(): string {
  return [
    'You select a chess move from a supplied Stockfish-filtered candidate list.',
    'Follow the requested JSON structure exactly and provide only visible commentary.',
    'Never reveal private reasoning or add fields beyond move and commentary.',
  ].join(' ');
}
