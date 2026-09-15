import { createRequire } from 'node:module';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

import { filterCredibleCandidates, joinLegalMoves } from './filter.js';
import { parseInfoLine } from './uci-parser.js';
import type {
  AnalysisRequest,
  RankedCandidate,
  StockfishAnalyzer,
} from './types.js';

const require = createRequire(import.meta.url);
const ENGINE_PATH =
  require.resolve('stockfish/bin/stockfish-18-lite-single.js');

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
      this.send('quit');
      this.child.kill();
      this.child = null;
    }
    this.lines?.close();
    this.lines = null;
  }

  private async start(): Promise<void> {
    if (this.child !== null) return;
    if (this.closed) throw new Error('Stockfish analyzer is closed');

    const child = spawn(process.execPath, [ENGINE_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', (line) => {
      for (const listener of this.lineListeners) listener(line);
    });
    child.stdin.on('error', (error) => this.emitError(error));
    child.once('error', (error) => this.emitError(error));
    child.once('exit', (code, signal) => {
      if (!this.closed && this.child === child) {
        this.emitError(
          new Error(`Stockfish exited (${code ?? `signal ${signal}`})`),
        );
      }
    });

    try {
      this.send('uci');
      await this.waitFor((line) => line.trim() === 'uciok', 10_000);
      this.send('isready');
      await this.waitFor((line) => line.trim() === 'readyok', 10_000);
    } catch (error) {
      this.killProcess();
      throw error;
    }
  }

  private async runAnalysis(
    request: AnalysisRequest,
  ): Promise<RankedCandidate[]> {
    if (request.signal?.aborted)
      throw new DOMException('Aborted', 'AbortError');
    await this.start();
    if (request.candidateLimit < 1) return [];

    const lines: string[] = [];
    const onAbort = () => {
      this.send('stop');
      this.killProcess(new DOMException('Aborted', 'AbortError'));
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      this.send(`setoption name MultiPV value ${request.candidateLimit}`);
      this.send(`position fen ${request.fen}`);
      this.send(`go movetime ${Math.max(1, request.moveTimeMs)}`);
      await this.waitFor(
        (line) => {
          if (line.startsWith('info ')) lines.push(line);
          return line.trim().startsWith('bestmove ');
        },
        Math.max(5_000, request.moveTimeMs + 5_000),
      );

      if (request.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const parsed = lines.flatMap((line) => {
        const info = parseInfoLine(line);
        return info === null ? [] : [info];
      });
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
        throw new DOMException('Aborted', 'AbortError');
      }
      if (error instanceof TimeoutError) this.killProcess();
      throw error;
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  private send(command: string): void {
    const child = this.child;
    if (child === null || child.stdin.destroyed) return;
    this.stdinReady = this.stdinReady
      .then(() => {
        if (child.stdin.destroyed) return;
        if (child.stdin.write(`${command}\n`)) return;
        return new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            child.stdin.removeListener('drain', onDrain);
            child.stdin.removeListener('error', onError);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          child.stdin.once('drain', onDrain);
          child.stdin.once('error', onError);
        });
      })
      .catch((error: unknown) => {
        this.emitError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs: number) {
    return new Promise<void>((resolve, reject) => {
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
      this.lineListeners.add(listener);
      this.errorListeners.add(onError);
    });
  }

  private emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) listener(error);
  }

  private killProcess(error?: Error): void {
    if (error !== undefined) this.emitError(error);
    this.lines?.close();
    this.lines = null;
    this.child?.kill();
    this.child = null;
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
