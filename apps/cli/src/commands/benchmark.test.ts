import { readFile } from 'node:fs/promises';

import { reconstructGame } from '@chess-llama/chess-domain';
import { describe, expect, it } from 'vitest';

import { CliFailure, exitCodes } from '../output.js';
import { runCli, type CliDependencies } from '../program.js';
import {
  aggregateBenchmarkResults,
  benchmarkHumanRows,
  type BenchmarkPositionResult,
  type BenchmarkReport,
} from './benchmark.js';

interface PositionFixture {
  id: string;
  category: string;
  fen: string;
}

describe('model benchmark', () => {
  it('validates every representative position FEN', async () => {
    const positions = JSON.parse(
      await readFile(
        new URL(
          '../../../../tests/fixtures/benchmarks/positions.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as PositionFixture[];

    expect(positions).toHaveLength(8);
    expect(new Set(positions.map((position) => position.category))).toEqual(
      new Set([
        'opening',
        'castling',
        'en-passant',
        'promotion',
        'forced-mate',
        'endgame',
        'positional',
      ]),
    );
    for (const position of positions) {
      expect(reconstructGame([], position.fen).fen()).toBe(position.fen);
    }
  });

  it('aggregates candidate membership, retry success, median latency, and commentary samples', () => {
    const summary = aggregateBenchmarkResults([
      {
        id: 'opening-start',
        category: 'opening',
        candidates: ['e2e4'],
        selection: {
          uci: 'e2e4',
          commentary: 'I take the center.',
          modelId: 'Qwen3-4B-Q4_K_M.gguf',
          latencyMs: 100,
          promptTokens: 40,
          completionTokens: 8,
          tokensPerSecond: 20,
          retryCount: 0,
        },
      },
      {
        id: 'rook-endgame',
        category: 'endgame',
        candidates: ['e2e4'],
        selection: {
          uci: 'e2e4',
          commentary: 'The rook stays active.',
          modelId: 'Qwen3-4B-Q4_K_M.gguf',
          latencyMs: 300,
          promptTokens: 40,
          completionTokens: 8,
          tokensPerSecond: 20,
          retryCount: 1,
        },
      },
      {
        id: 'promotion',
        category: 'promotion',
        candidates: ['g1f3'],
        selection: {
          uci: 'e2e4',
          commentary: 'This must not qualify.',
          modelId: 'Qwen3-4B-Q4_K_M.gguf',
          latencyMs: 200,
          promptTokens: null,
          completionTokens: null,
          tokensPerSecond: null,
          retryCount: 0,
        },
      },
    ]);

    expect(summary).toMatchObject({
      totalPositions: 3,
      candidateMembership: 2 / 3,
      firstAttemptSuccess: 1 / 3,
      successAfterRetry: 2 / 3,
      medianLatencyMs: 200,
      commentarySamples: [
        'I take the center.',
        'The rook stays active.',
        'This must not qualify.',
      ],
      status: 'FAIL',
    });
    expect(summary.qualified).toBe(false);
  });

  it('qualifies only when every automated threshold passes', () => {
    const passing: BenchmarkPositionResult[] = Array.from(
      { length: 20 },
      (_, index) => ({
        id: `position-${index}`,
        category: 'opening',
        candidates: ['e2e4'],
        selection: {
          uci: 'e2e4',
          commentary: `Commentary ${index}`,
          modelId: 'Qwen3-4B-Q4_K_M.gguf',
          latencyMs: index === 19 ? 2_999 : 100,
          promptTokens: 40,
          completionTokens: 8,
          tokensPerSecond: 20,
          retryCount: index === 19 ? 1 : 0,
        },
      }),
    );

    expect(aggregateBenchmarkResults(passing)).toMatchObject({
      candidateMembership: 1,
      firstAttemptSuccess: 0.95,
      successAfterRetry: 1,
      medianLatencyMs: 100,
      qualified: true,
      status: 'PASS',
    });
    expect(
      aggregateBenchmarkResults(
        passing.map((position) => ({
          ...position,
          selection: position.selection
            ? { ...position.selection, latencyMs: 3_000 }
            : null,
        })),
      ).qualified,
    ).toBe(false);
  });

  it('renders a concise human qualification table with commentary samples', () => {
    const value = report(true);
    value.reportFile = '/data/benchmarks/report.json';
    value.profiles = [
      {
        profileId: 'qwen3-4b-q4-k-m',
        positions: [],
        summary: {
          totalPositions: 8,
          candidateMembership: 1,
          firstAttemptSuccess: 1,
          successAfterRetry: 1,
          medianLatencyMs: 850,
          commentarySamples: ['I take the center.', 'I develop with tempo.'],
          qualified: true,
          status: 'PASS',
        },
      },
    ];

    expect(benchmarkHumanRows(value)).toEqual([
      {
        profile: 'qwen3-4b-q4-k-m',
        status: 'PASS',
        positions: 8,
        candidateMembership: '100.0%',
        firstAttemptSuccess: '100.0%',
        successAfterRetry: '100.0%',
        medianLatencyMs: 850,
        commentarySamples: 'I take the center. | I develop with tempo.',
        reportFile: '/data/benchmarks/report.json',
      },
    ]);
  });

  it('accepts repeated profiles and stable output/qualification exit codes', async () => {
    const calls: string[][] = [];
    const writes: Array<{ value: unknown; format?: 'json' | 'human' }> = [];
    const dependencies = cliDependencies(
      {
        run: (profiles) => {
          calls.push([...profiles]);
          return Promise.resolve(report(true));
        },
      },
      writes,
    );

    await expect(
      runCli(
        [
          'model',
          'benchmark',
          '--profile',
          'qwen3-4b-q4-k-m',
          '--profile',
          'qwen3-1.7b-q4-k-m',
          '--format',
          'json',
        ],
        dependencies,
      ),
    ).resolves.toBe(0);
    expect(calls).toEqual([['qwen3-4b-q4-k-m', 'qwen3-1.7b-q4-k-m']]);
    expect(writes).toEqual([{ value: report(true), format: 'json' }]);

    dependencies.benchmark = {
      run: () => Promise.resolve(report(false)),
    };
    await expect(runCli(['model', 'benchmark'], dependencies)).resolves.toBe(1);

    dependencies.benchmark = {
      run: () =>
        Promise.reject(
          new CliFailure('Model weights are missing', exitCodes.prerequisite),
        ),
    };
    await expect(runCli(['model', 'benchmark'], dependencies)).resolves.toBe(3);
    await expect(
      runCli(['model', 'benchmark', '--format', 'xml'], dependencies),
    ).resolves.toBe(2);
  });
});

function report(qualified: boolean): BenchmarkReport {
  return {
    schemaVersion: 1,
    generatedAt: '2026-09-16T00:00:00.000Z',
    runtimeManifest: {
      schemaVersion: 1,
      image: 'example@sha256:abc',
      generatedAt: '2026-09-15T00:00:00.000Z',
    },
    hardware: {
      platform: 'linux',
      arch: 'x64',
      nodeVersion: 'v24.0.0',
      cpuModel: 'test cpu',
      logicalCpuCount: 8,
      memoryBytes: 16_000_000_000,
      accelerator: 'reported-by-llama-server',
    },
    profiles: [],
    qualified,
    status: qualified ? 'PASS' : 'FAIL',
  };
}

function cliDependencies(
  benchmark: NonNullable<CliDependencies['benchmark']>,
  writes: Array<{ value: unknown; format?: 'json' | 'human' }>,
): CliDependencies {
  const unused = () => Promise.resolve();
  return {
    benchmark,
    database: {
      migrate: unused,
      status: unused,
      backup: () => Promise.resolve(''),
    },
    model: {
      pull: unused,
      start: unused,
      stop: unused,
      status: unused,
      logs: unused,
    },
    gateway: { dev: unused, start: unused, stop: unused, health: unused },
    client: { build: unused, dev: unused, serve: unused, stop: unused },
    doctor: () => Promise.resolve({ ok: true, checks: [] }),
    output: {
      write: (value, format) =>
        writes.push({ value, ...(format ? { format } : {}) }),
      error: () => undefined,
    },
  };
}
