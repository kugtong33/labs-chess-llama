import { useEffect, useRef, useState } from 'react';
import {
  DecisionTraceEventSchema,
  type DecisionTraceEvent,
} from '@chess-llama/contracts';

export interface DecisionEventSource {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type DecisionEventSourceFactory = (url: string) => DecisionEventSource;
export type DecisionConnection =
  'connecting' | 'connected' | 'disconnected' | 'disabled';

export interface UseDecisionEventsOptions {
  enabled?: boolean;
  createEventSource?: DecisionEventSourceFactory;
  maxEvents?: number;
}

const MAX_EVENTS = 200;

export function parseDecisionTraceEvent(
  value: string,
): DecisionTraceEvent | null {
  try {
    const parsed = DecisionTraceEventSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useDecisionEvents(
  url: string,
  {
    enabled = true,
    createEventSource = defaultEventSource,
    maxEvents = MAX_EVENTS,
  }: UseDecisionEventsOptions = {},
): { events: DecisionTraceEvent[]; connection: DecisionConnection } {
  const [events, setEvents] = useState<DecisionTraceEvent[]>([]);
  const [connection, setConnection] = useState<DecisionConnection>(
    enabled && url ? 'connecting' : 'disabled',
  );
  const eventSourceFactory = useRef(createEventSource);

  useEffect(() => {
    if (!enabled || !url) {
      setConnection('disabled');
      setEvents([]);
      return;
    }
    setConnection('connecting');
    const seen = new Set<string>();
    let source: DecisionEventSource;
    try {
      source = eventSourceFactory.current(url);
    } catch {
      setConnection('disconnected');
      return;
    }
    const onOpen = () => setConnection('connected');
    const onError = () => setConnection('disconnected');
    const onTrace = (message: Event) => {
      const payload = message instanceof MessageEvent ? message.data : '';
      if (typeof payload !== 'string') return;
      const event = parseDecisionTraceEvent(payload);
      if (event === null || seen.has(event.id)) return;
      seen.add(event.id);
      setEvents((current) => [...current, event].slice(-maxEvents));
    };
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);
    source.addEventListener('decision-trace', onTrace);
    return () => {
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      source.removeEventListener('decision-trace', onTrace);
      source.close();
    };
  }, [enabled, maxEvents, url]);

  return { events, connection };
}

function defaultEventSource(url: string): DecisionEventSource {
  return new EventSource(url);
}
