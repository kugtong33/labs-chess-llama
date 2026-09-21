import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reconstructGame } from '@chess-llama/chess-domain';
import { describe, expect, it } from 'vitest';

import type { RuntimeManifest, RuntimeProfile } from '@chess-llama/contracts';
import {
  aggregateBenchmarkResults,
  benchmarkHumanRows,
  exitCodes,
  isProfileModelId,
  runInstalledBenchmarks,
  type BenchmarkPositionResult,
  type BenchmarkReport,
} from './benchmark.js';

interface PositionFixture {
  id: string;
  category: string;
  fen: string;
}

describe('model benchmark', () => {
  it('accepts either the artifact filename or native profile alias as the model identity', () => {
    const profile = {
      id: 'qwen3-4b-q4-k-m',
      file: 'Qwen3-4B-Q4_K_M.gguf',
    };

    expect(isProfileModelId(profile, profile.file)).toBe(true);
    expect(isProfileModelId(profile, profile.id)).toBe(true);
    expect(isProfileModelId(profile, 'other-model')).toBe(false);
  });

  it('validates every representative position FEN', async () => {
    const positions = JSON.parse(
      await readFile(
        new URL('./benchmark-positions.json', import.meta.url),
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
        artifact: {
          id: 'qwen3-4b-q4-k-m',
          repository: 'Qwen/Qwen3-4B-GGUF',
          revision: 'main',
          file: 'Qwen3-4B-Q4_K_M.gguf',
          sha256: 'a'.repeat(64),
          quantization: 'Q4_K_M',
          contextSize: 4096,
          experimental: false,
        },
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

  it('rejects a different loaded model before attributing qualification', async () => {
    const harness = await installedBenchmarkHarness();

    await expect(
      runInstalledBenchmarks({
        ...harness.options,
        fixtures: [],
        loadedModelId: () => Promise.resolve('different-model.gguf'),
        runProfile: () => Promise.resolve(profileReport(harness.profile)),
      }),
    ).rejects.toMatchObject({ code: exitCodes.health });
  });

  it('accepts the profile alias reported by a native llama-server', async () => {
    const harness = await installedBenchmarkHarness();

    await expect(
      runInstalledBenchmarks({
        ...harness.options,
        fixtures: [],
        loadedModelId: () => Promise.resolve(harness.profile.id),
        runProfile: () => Promise.resolve(profileReport(harness.profile)),
      }),
    ).resolves.toMatchObject({ status: 'FAIL' });
  });

  it('verifies and records the immutable profile artifact identity', async () => {
    const harness = await installedBenchmarkHarness();
    const report = await runInstalledBenchmarks({
      ...harness.options,
      fixtures: [],
      loadedModelId: () => Promise.resolve(harness.profile.file),
      runProfile: () => Promise.resolve(profileReport(harness.profile)),
      now: () => new Date('2026-09-16T00:00:00.000Z'),
    });

    expect(report.profiles[0]?.artifact).toEqual({
      id: harness.profile.id,
      repository: harness.profile.repository,
      revision: harness.profile.source.revision,
      file: harness.profile.file,
      sha256: harness.profile.sha256,
      quantization: harness.profile.quantization,
      contextSize: harness.profile.contextSize,
      experimental: false,
    });
    expect(report.hardware.accelerator).toBe('Metal');

    const corruptManifest: RuntimeManifest = {
      ...harness.options.manifest,
      profiles: [{ ...harness.profile, sha256: '0'.repeat(64) }],
    };
    await expect(
      runInstalledBenchmarks({
        ...harness.options,
        manifest: corruptManifest,
        fixtures: [],
        loadedModelId: () => Promise.resolve(harness.profile.file),
        runProfile: () => Promise.resolve(profileReport(harness.profile)),
      }),
    ).rejects.toMatchObject({ code: exitCodes.prerequisite });
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
      accelerator: 'Metal',
    },
    profiles: [],
    qualified,
    status: qualified ? 'PASS' : 'FAIL',
  };
}

async function installedBenchmarkHarness(): Promise<{
  profile: RuntimeProfile;
  options: {
    paths: { modelDir: string; benchmarksDir: string };
    manifest: RuntimeManifest;
    profileIds: string[];
    runtimeBackend: 'Metal';
  };
}> {
  const root = await mkdtemp(join(tmpdir(), 'chess-llama-benchmark-'));
  const modelDir = join(root, 'models');
  const file = 'test-model.gguf';
  const bytes = 'verified test weights';
  await mkdir(modelDir, { recursive: true });
  await writeFile(join(modelDir, file), bytes, 'utf8');
  const profile: RuntimeProfile = {
    id: 'test-profile',
    repository: 'test/repository',
    file,
    quantization: 'Q4_K_M',
    contextSize: 4096,
    url: 'https://example.test/model.gguf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: { repository: 'test/repository', revision: 'test-revision' },
  };
  return {
    profile,
    options: {
      paths: { modelDir, benchmarksDir: join(root, 'benchmarks') },
      manifest: {
        schemaVersion: 1,
        generatedAt: '2026-09-15T00:00:00.000Z',
        image: `example@sha256:${'a'.repeat(64)}`,
        source: { image: 'example:cuda' },
        profiles: [profile],
      },
      profileIds: [profile.id],
      runtimeBackend: 'Metal' as const,
    },
  };
}

function profileReport(profile: RuntimeProfile) {
  return {
    profileId: profile.id,
    artifact: {
      id: profile.id,
      repository: profile.repository,
      revision: profile.source.revision,
      file: profile.file,
      sha256: profile.sha256,
      quantization: profile.quantization,
      contextSize: profile.contextSize,
      experimental: profile.experimental ?? false,
    },
    positions: [],
    summary: {
      totalPositions: 0,
      candidateMembership: 0,
      firstAttemptSuccess: 0,
      successAfterRetry: 0,
      medianLatencyMs: null,
      commentarySamples: [],
      qualified: false,
      status: 'FAIL' as const,
    },
  };
}
