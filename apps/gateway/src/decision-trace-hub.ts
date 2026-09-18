import { randomUUID } from 'node:crypto';

import {
  DecisionTraceEventSchema,
  type DecisionTraceEvent,
  type DecisionTraceEventInput,
  type DecisionTraceFilter,
} from '@chess-llama/contracts';

type DecisionTraceListener = (
  event: DecisionTraceEvent,
) => void | Promise<void>;

interface Subscription {
  filter: DecisionTraceFilter;
  listener: DecisionTraceListener;
}

const MAX_EVENTS = 200;

export class DecisionTraceHub {
  private readonly events: DecisionTraceEvent[] = [];
  private readonly subscriptions = new Set<Subscription>();
  private nextSequence = 0;

  publish(input: DecisionTraceEventInput): DecisionTraceEvent | null {
    const parsed = DecisionTraceEventSchema.safeParse({
      ...input,
      id: randomUUID(),
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
    });
    if (!parsed.success) return null;

    const event = parsed.data;
    this.nextSequence += 1;
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();

    for (const subscription of this.subscriptions) {
      if (!matches(subscription.filter, event)) continue;
      try {
        void Promise.resolve(subscription.listener(event)).catch(
          () => undefined,
        );
      } catch {
        // A trace subscriber is observational and cannot interrupt a move.
      }
    }
    return event;
  }

  snapshot(filter: DecisionTraceFilter): DecisionTraceEvent[] {
    return this.events.filter((event) => matches(filter, event));
  }

  subscribe(
    filter: DecisionTraceFilter,
    listener: DecisionTraceListener,
  ): () => void {
    const subscription = { filter, listener };
    this.subscriptions.add(subscription);
    for (const event of this.snapshot(filter)) {
      try {
        void Promise.resolve(listener(event)).catch(() => undefined);
      } catch {
        // Buffered replay has the same best-effort delivery guarantee.
      }
    }
    return () => this.subscriptions.delete(subscription);
  }
}

function matches(
  filter: DecisionTraceFilter,
  event: DecisionTraceEvent,
): boolean {
  return (
    (filter.layer === undefined || filter.layer === event.layer) &&
    (filter.gameId === undefined || filter.gameId === event.gameId)
  );
}
