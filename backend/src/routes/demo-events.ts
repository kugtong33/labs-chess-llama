import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DecisionTraceLayerSchema } from '@chess-llama/contracts';
import type { DecisionTraceHub } from '../decision-trace-hub.js';

const FilterSchema = z
  .object({
    layer: DecisionTraceLayerSchema.optional(),
    gameId: z.string().uuid().optional(),
  })
  .strict();

export function registerDemoEventRoutes(
  app: FastifyInstance,
  hub: DecisionTraceHub,
): void {
  const connections = new Set<() => void>();
  app.addHook('preClose', (done) => {
    for (const close of connections) close();
    done();
  });

  app.get('/api/demo/events', (request, reply) => {
    const filter = FilterSchema.parse(request.query);
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    let closed = false;
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let backpressured = false;
    const pending: string[] = [];
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat !== undefined) clearInterval(heartbeat);
      connections.delete(close);
      pending.length = 0;
      reply.raw.removeListener('close', close);
      reply.raw.removeListener('error', close);
      reply.raw.removeListener('drain', drain);
      reply.raw.end();
    };
    const write = (frame: string) => {
      if (closed) return;
      if (backpressured) {
        if (pending.length >= 200) close();
        else pending.push(frame);
        return;
      }
      try {
        backpressured = !reply.raw.write(frame);
      } catch {
        close();
      }
    };
    const drain = () => {
      backpressured = false;
      while (!closed && !backpressured && pending.length > 0)
        write(pending.shift()!);
    };
    connections.add(close);
    reply.raw.once('close', close);
    reply.raw.once('error', close);
    reply.raw.on('drain', drain);
    write(': connected\n\n');
    unsubscribe = hub.subscribe(filter, (event) => {
      write(
        `id: ${event.id}\nevent: decision-trace\ndata: ${JSON.stringify(event)}\n\n`,
      );
    });
    // Buffered replay can close the connection before subscribe returns.
    if (closed) unsubscribe();
    else {
      heartbeat = setInterval(() => write(': heartbeat\n\n'), 15_000);
      heartbeat.unref();
    }
  });
}
