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
  pending: DecisionTraceEvent[];
  active: boolean;
  delivering: boolean;
  scheduled?: ReturnType<typeof setImmediate>;
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
      subscription.pending.push(event);
      if (subscription.pending.length > MAX_EVENTS)
        subscription.pending.shift();
      scheduleDelivery(subscription);
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
    const subscription: Subscription = {
      filter,
      listener,
      pending: this.snapshot(filter),
      active: true,
      delivering: false,
    };
    this.subscriptions.add(subscription);
    scheduleDelivery(subscription);
    return () => {
      subscription.active = false;
      subscription.pending.length = 0;
      if (subscription.scheduled !== undefined)
        clearImmediate(subscription.scheduled);
      this.subscriptions.delete(subscription);
    };
  }
}

function scheduleDelivery(subscription: Subscription): void {
  if (
    !subscription.active ||
    subscription.delivering ||
    subscription.scheduled !== undefined ||
    subscription.pending.length === 0
  )
    return;
  // A macrotask keeps observer code out of publication and move continuations.
  subscription.scheduled = setImmediate(() => {
    subscription.scheduled = undefined;
    if (!subscription.active) return;
    const event = subscription.pending.shift();
    if (event === undefined) return;
    subscription.delivering = true;
    const finished = () => {
      subscription.delivering = false;
      scheduleDelivery(subscription);
    };
    try {
      // One in-flight callback per subscriber bounds even stalled async observers.
      void Promise.resolve(subscription.listener(event)).then(
        finished,
        finished,
      );
    } catch {
      finished();
    }
  });
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
