export type GameServiceErrorCode =
  | 'GAME_NOT_FOUND'
  | 'GAME_COMPLETED'
  | 'STALE_PLY'
  | 'ILLEGAL_MOVE'
  | 'WRONG_TURN'
  | 'AI_UNAVAILABLE'
  | 'AI_INVALID_MOVE';

export class GameServiceError extends Error {
  constructor(
    public readonly code: GameServiceErrorCode,
    message: string,
    public readonly gameStatus?: 'active' | 'awaiting_ai' | 'completed',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GameServiceError';
  }
}

export class StalePlyError extends GameServiceError {
  constructor(expected: number, actual: number) {
    super('STALE_PLY', `Expected ply ${expected}, but game is at ${actual}`);
  }
}
