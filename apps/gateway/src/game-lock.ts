export class GameLock {
  private readonly queues = new Map<string, Promise<void>>();

  async runExclusive<T>(
    gameId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(gameId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const marker = current.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(gameId, marker);
    try {
      return await current;
    } finally {
      if (this.queues.get(gameId) === marker) this.queues.delete(gameId);
    }
  }
}
