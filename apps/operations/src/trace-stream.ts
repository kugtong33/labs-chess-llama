import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

import {
  DecisionTraceEventSchema,
  type DecisionTraceEvent,
} from '@chess-llama/contracts';

export type TraceOutputFormat = 'human' | 'json';

interface SseFrame {
  id: string | undefined;
  event: string | undefined;
  data: string[];
}

export async function* parseTraceStream(
  source: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<DecisionTraceEvent> {
  const seenIds = new Set<string>();
  const decoder = new StringDecoder('utf8');
  let remainder = '';
  let frame: SseFrame = emptyFrame();

  const emit = (): DecisionTraceEvent | undefined => {
    if (frame.data.length === 0) {
      frame = emptyFrame();
      return undefined;
    }
    if (frame.event !== 'decision-trace' || !frame.id)
      throw new Error('Invalid decision trace SSE frame');
    if (seenIds.has(frame.id))
      throw new Error(`Duplicate decision trace event ID: ${frame.id}`);

    let value: unknown;
    try {
      value = JSON.parse(frame.data.join('\n'));
    } catch {
      throw new Error('Invalid decision trace event: malformed JSON');
    }
    const parsed = DecisionTraceEventSchema.safeParse(value);
    if (!parsed.success)
      throw new Error(`Invalid decision trace event: ${parsed.error.message}`);
    if (parsed.data.id !== frame.id)
      throw new Error(
        'Invalid decision trace event: SSE ID does not match payload',
      );

    seenIds.add(frame.id);
    frame = emptyFrame();
    return parsed.data;
  };

  for await (const chunk of source) {
    remainder += decoder.write(Buffer.from(chunk));
    let newline = remainder.indexOf('\n');
    while (newline !== -1) {
      const line = remainder.slice(0, newline).replace(/\r$/u, '');
      remainder = remainder.slice(newline + 1);
      if (line.length === 0) {
        const event = emit();
        if (event) yield event;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value =
          colon === -1 ? '' : line.slice(colon + 1).replace(/^ /u, '');
        if (field === 'id') frame.id = value;
        else if (field === 'event') frame.event = value;
        else if (field === 'data') frame.data.push(value);
      }
      newline = remainder.indexOf('\n');
    }
  }

  remainder += decoder.end();
  if (remainder.length > 0 || frame.data.length > 0 || frame.id || frame.event)
    throw new Error('Incomplete decision trace SSE frame at end of stream');
}

export function formatTraceEvent(
  event: DecisionTraceEvent,
  format: TraceOutputFormat,
): string {
  if (format === 'json') return JSON.stringify(event);
  const time = event.timestamp.slice(11);
  const game = event.gameId ? shortId(event.gameId) : '-';
  const details = traceDetails(event);
  return [
    time,
    event.layer.toUpperCase(),
    `${event.stage}/${event.status}`,
    `trace=${shortId(event.traceId)}`,
    `game=${game}`,
    oneLine(event.summary),
    details,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function formatTraceStream(
  source: AsyncIterable<string | Uint8Array>,
  format: TraceOutputFormat,
  write: (line: string) => void,
): Promise<void> {
  for await (const event of parseTraceStream(source))
    write(formatTraceEvent(event, format));
}

function emptyFrame(): SseFrame {
  return { id: undefined, event: undefined, data: [] };
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function traceDetails(event: DecisionTraceEvent): string {
  const fields: string[] = [];
  const add = (
    name: string,
    value: string | number | null | undefined,
    suffix = '',
  ) => {
    if (value !== undefined && value !== null)
      fields.push(`${name}=${value}${suffix}`);
  };
  switch (event.stage) {
    case 'ai_turn_started':
    case 'analysis_started':
      add('candidates', event.data.candidateLimit);
      add('moveTime', event.data.moveTimeMs, 'ms');
      break;
    case 'analysis_completed':
    case 'attempt_started':
      add('candidates', candidateList(event.data.candidates));
      if (event.stage === 'attempt_started')
        add('profile', event.data.profileId);
      break;
    case 'ai_turn_completed':
      add('move', event.data.selectedMove);
      break;
    case 'retry_scheduled':
      add('retry', event.data.attempt);
      add('reason', event.data.reason);
      break;
    case 'selection_completed':
      add('move', event.data.selectedMove);
      add('retry', event.data.retryCount);
      add('model', event.data.modelId);
      add('latency', event.data.latencyMs, 'ms');
      if (
        event.data.promptTokens !== null ||
        event.data.completionTokens !== null
      )
        fields.push(
          `tokens=${event.data.promptTokens ?? '-'}+${event.data.completionTokens ?? '-'}`,
        );
      add('tps', event.data.tokensPerSecond);
      add('commentary', oneLine(event.data.commentary));
      break;
    case 'ai_turn_failed':
    case 'selection_failed':
      add('reason', event.data.reason);
      break;
    case 'decision_persisted':
      add('move', event.data.chosenUci);
      add('decision', shortId(event.data.decisionId));
      break;
    default:
      break;
  }
  return fields.join(' ');
}

function candidateList(value: { rank: number; san: string }[]): string {
  return value
    .map((candidate) => `${candidate.rank}:${candidate.san}`)
    .join(',');
}

async function main(): Promise<void> {
  const [flag, format, ...remaining] = process.argv.slice(2);
  if (
    flag !== '--format' ||
    (format !== 'human' && format !== 'json') ||
    remaining.length
  )
    throw new Error('Usage: trace-stream --format human|json');
  await formatTraceStream(process.stdin, format, (line) => {
    process.stdout.write(`${line}\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
