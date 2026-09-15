import { describe, expect, it } from 'vitest';
import {
  AiMoveRequestSchema,
  CreateGameRequestSchema,
  GameViewSchema,
  SettingsSchema,
  SubmitMoveRequestSchema,
} from './index.js';

describe('public contracts', () => {
  it('accepts valid move requests and rejects stale shapes', () => {
    expect(
      SubmitMoveRequestSchema.parse({ from: 'e2', to: 'e4', expectedPly: 0 }),
    ).toEqual({
      from: 'e2',
      to: 'e4',
      expectedPly: 0,
    });
    expect(() =>
      SubmitMoveRequestSchema.parse({ from: 'e9', to: 'e4', expectedPly: -1 }),
    ).toThrow();
    expect(AiMoveRequestSchema.parse({ expectedPly: 1 })).toEqual({
      expectedPly: 1,
    });
  });

  it('applies stable game and settings defaults', () => {
    expect(CreateGameRequestSchema.parse({})).toEqual({});
    const settings = SettingsSchema.parse({
      preferredHumanColor: 'white',
      boardOrientation: 'white',
      theme: 'system',
      commentaryStyle: 'concise',
      modelProfileId: 'qwen3-4b-q4-k-m',
      stockfishCandidateLimit: 5,
      stockfishMoveTimeMs: 100,
    });
    expect(settings.stockfishCandidateLimit).toBe(5);
  });

  it('requires authoritative game fields', () => {
    expect(() =>
      GameViewSchema.parse({ id: 'game-1', status: 'active' }),
    ).toThrow();
  });
});
