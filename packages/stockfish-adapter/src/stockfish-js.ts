import { createRequire } from 'node:module';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

import { filterCredibleCandidates, joinLegalMoves } from './filter.js';
import { parseInfoLines } from './uci-parser.js';
import type {
  AnalysisRequest,
  RankedCandidate,
  StockfishAnalyzer,
} from './types.js';

const require = createRequire(import.meta.url);
const ENGINE_PATH =
  require.resolve('stockfish/bin/stockfish-18-lite-single.js');

type PendingWait = Promise<void> & { cancel: () => void };

export class StockfishJsAnalyzer implements StockfishAnalyzer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private lineListeners = new Set<(line: string) => void>();
  private errorListeners = new Set<(error: Error) => void>();
  private queue: Promise<void> = Promise.resolve();
  private stdinReady: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor() {}

  static async create(): Promise<StockfishJsAnalyzer> {
    const analyzer = new StockfishJsAnalyzer();
    await analyzer.start();
    return analyzer;
  }

  analyze(request: AnalysisRequest): Promise<RankedCandidate[]> {
    const run = this.queue.then(() => this.runAnalysis(request));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    if (this.child !== null) {
      void this.send('quit');
      this.terminateProcess(this.child);
      this.child = null;
      this.stdinReady = Promise.resolve();
    }
    this.lines?.close();
    this.lines = null;
  }

  private async start(): Promise<void> {
    if (this.child !== null) return;
    if (this.closed) throw new Error('Stockfish analyzer is closed');

    // Stockfish.js treats the non-blocking socket that Node uses for a child
    // stdin pipe as EOF during WASM startup. util-linux `script` provides a
    // pseudo-terminal while preserving the UCI stream and exit status.
    const child = spawn(
      'script',
      ['-qefc', 'exec "$STOCKFISH_NODE" "$STOCKFISH_ENGINE"', '/dev/null'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        env: {
          ...process.env,
          STOCKFISH_NODE: process.execPath,
          STOCKFISH_ENGINE: ENGINE_PATH,
        },
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', (line) => {
      for (const listener of this.lineListeners) listener(line);
    });
    child.stdin.once('error', (error) => this.markDead(child, error));
    child.stdin.once('close', () =>
      this.markDead(child, new Error('Stockfish stdin closed')),
    );
    child.once('error', (error) => this.markDead(child, error));
    child.once('exit', (code, signal) => {
      if (!this.closed && this.child === child) {
        this.markDead(
          child,
          new Error(
            `Stockfish exited (${code ?? `signal ${signal}`})${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
          ),
        );
      }
    });

    try {
      await this.sendAndWait('uci', (line) => line.trim() === 'uciok', 10_000);
      await this.sendAndWait(
        'isready',
        (line) => line.trim() === 'readyok',
        10_000,
      );
    } catch (error) {
      if (this.child === child) this.killProcess();
      throw error;
    }
  }

  private async runAnalysis(
    request: AnalysisRequest,
  ): Promise<RankedCandidate[]> {
    const abortError = new DOMException('Aborted', 'AbortError');
    let cancellation: Promise<void> | null = null;
    const onAbort = () => {
      if (cancellation === null) {
        cancellation = this.stopAndKill(abortError);
      }
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      if (request.signal?.aborted) {
        onAbort();
        throw abortError;
      }
      await this.start();
      if (request.signal?.aborted) throw abortError;
      if (request.candidateLimit < 1) return [];

      const lines: string[] = [];
      await this.send(`setoption name MultiPV value ${request.candidateLimit}`);
      await this.send(`position fen ${request.fen}`);
      const bestMove = this.waitFor(
        (line) => {
          if (line.startsWith('info ')) lines.push(line);
          return line.trim().startsWith('bestmove ');
        },
        Math.max(5_000, request.moveTimeMs + 5_000),
      );
      try {
        await this.send(`go movetime ${Math.max(1, request.moveTimeMs)}`);
        await bestMove;
      } catch (error) {
        bestMove.cancel();
        await bestMove.catch(() => undefined);
        throw error;
      }

      if (request.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const parsed = parseInfoLines(lines);
      const legal = new Map(
        request.legalMoves.map((move) => [move.uci, move.san]),
      );
      const rankOne = parsed.find((candidate) => candidate.rank === 1);
      if (rankOne === undefined || !legal.has(rankOne.uci)) {
        throw new Error('Stockfish returned no authoritative legal best move');
      }
      for (const candidate of parsed) {
        if (!legal.has(candidate.uci)) {
          throw new Error(`Stockfish returned illegal move: ${candidate.uci}`);
        }
      }

      return filterCredibleCandidates(
        joinLegalMoves(parsed, request.legalMoves),
        request.maxLossCp,
      ).slice(0, request.candidateLimit);
    } catch (error) {
      if (request.signal?.aborted) {
        if (cancellation !== null) await Promise.resolve(cancellation);
        throw abortError;
      }
      if (error instanceof TimeoutError) this.killProcess();
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  private send(command: string): Promise<void> {
    const child = this.child;
    if (child === null || child.stdin.destroyed) return Promise.resolve();
    const write = this.stdinReady.then(() => this.writeCommand(child, command));
    this.stdinReady = write.catch(() => undefined);
    return write;
  }

  private async sendAndWait(
    command: string,
    predicate: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<void> {
    const response = this.waitFor(predicate, timeoutMs);
    try {
      await this.send(command);
      await response;
    } catch (error) {
      response.cancel();
      await response.catch(() => undefined);
      throw error;
    }
  }

  private writeCommand(
    child: ChildProcessWithoutNullStreams,
    command: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let callbackDone = false;
      let drainDone = true;
      const cleanup = () => {
        child.stdin.removeListener('drain', onDrain);
        child.stdin.removeListener('error', onError);
        child.stdin.removeListener('close', onClose);
        child.removeListener('exit', onExit);
      };
      const finish = () => {
        if (callbackDone && drainDone) {
          cleanup();
          resolve();
        }
      };
      const onDrain = () => {
        drainDone = true;
        finish();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Stockfish stdin closed before draining'));
      };
      const onExit = () => {
        cleanup();
        reject(new Error('Stockfish exited before stdin drained'));
      };
      child.stdin.once('drain', onDrain);
      child.stdin.once('error', onError);
      child.stdin.once('close', onClose);
      child.once('exit', onExit);
      try {
        drainDone = child.stdin.write(
          `${command}\n`,
          (error?: Error | null) => {
            if (error !== undefined && error !== null) {
              onError(error);
              return;
            }
            callbackDone = true;
            finish();
          },
        );
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
  ): PendingWait {
    let cancel!: () => void;
    const pending = new Promise<void>((resolve, reject) => {
      const listener = (line: string) => {
        if (!predicate(line)) return;
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new TimeoutError('Stockfish response timed out'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.lineListeners.delete(listener);
        this.errorListeners.delete(onError);
      };
      cancel = () => {
        cleanup();
        reject(new Error('Stockfish response wait cancelled'));
      };
      this.lineListeners.add(listener);
      this.errorListeners.add(onError);
    });
    return Object.assign(pending, { cancel });
  }

  private emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) listener(error);
  }

  private markDead(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    this.stdinReady = Promise.resolve();
    if (!this.closed) this.emitError(error);
  }

  private async stopAndKill(error: Error): Promise<void> {
    const stop = this.send('stop').catch(() => undefined);
    await Promise.race([
      stop,
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]);
    this.emitError(error);
    this.killProcess();
  }

  private killProcess(error?: Error): void {
    if (error !== undefined) this.emitError(error);
    this.lines?.close();
    this.lines = null;
    if (this.child !== null) this.terminateProcess(this.child);
    this.child = null;
    this.stdinReady = Promise.resolve();
  }

  private terminateProcess(child: ChildProcessWithoutNullStreams): void {
    try {
      if (child.pid === undefined) child.kill();
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
