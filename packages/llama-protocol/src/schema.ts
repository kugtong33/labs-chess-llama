import type { MoveCandidate } from './types.js';

export interface MoveResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: 'chess_move';
    strict: true;
    schema: {
      type: 'object';
      additionalProperties: false;
      properties: {
        move: { type: 'string'; enum: string[] };
        commentary: { type: 'string'; minLength: 1; maxLength: 240 };
      };
      required: ['move', 'commentary'];
    };
  };
}

export function buildMoveResponseFormat(
  candidates: readonly MoveCandidate[],
): MoveResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'chess_move',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          move: {
            type: 'string',
            enum: candidates.map((candidate) => candidate.uci),
          },
          commentary: {
            type: 'string',
            minLength: 1,
            maxLength: 240,
          },
        },
        required: ['move', 'commentary'],
      },
    },
  };
}
