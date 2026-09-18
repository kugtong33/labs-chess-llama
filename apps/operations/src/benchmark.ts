import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { arch, platform, version as nodeVersion } from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { legalMoves, reconstructGame } from '@chess-llama/chess-domain';
import { LlamaCppClient } from '@chess-llama/llama-protocol';
import { StockfishJsAnalyzer } from '@chess-llama/stockfish-adapter';
import type { RuntimeManifest, RuntimeProfile } from '@chess-llama/contracts';
import benchmarkFixtureData from './benchmark-positions.json' with { type: 'json' };
import { loadRuntimeManifest } from './runtime-manifest.js';

const execFileAsync = promisify(execFile);

export interface ChessLlamaPaths {
  benchmarksDir: string;
  modelDir: string;
}

export const exitCodes = {
  unexpected: 1,
  input: 2,
  prerequisite: 3,
  runtime: 4,
  health: 5,
  storage: 6,
} as const;

export class CliFailure extends Error {
  public constructor(
    message: string,
    public readonly code: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

const MAX_CANDIDATE_LOSS_CP = 150;
const CANDIDATE_LIMIT = 5;
const MOVE_TIME_MS = 100;

export interface BenchmarkFixture {
  id: string;
  category: string;
  fen: string;
}

export interface BenchmarkSelection {
  uci: string;
  commentary: string;
  modelId: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  tokensPerSecond: number | null;
  retryCount: 0 | 1;
}

export interface BenchmarkPositionResult {
  id: string;
  category: string;
  candidates: readonly string[];
  selection: BenchmarkSelection | null;
  error?: string;
}

export interface BenchmarkSummary {
  totalPositions: number;
  candidateMembership: number;
  firstAttemptSuccess: number;
  successAfterRetry: number;
  medianLatencyMs: number | null;
  commentarySamples: string[];
  qualified: boolean;
  status: 'PASS' | 'FAIL';
}

export interface BenchmarkProfileReport {
  profileId: string;
  artifact: BenchmarkProfileArtifact;
  positions: BenchmarkPositionResult[];
  summary: BenchmarkSummary;
}

export interface BenchmarkProfileArtifact {
  id: string;
  repository: string;
  revision: string;
  file: string;
  sha256: string;
  quantization: string;
  contextSize: number;
  experimental: boolean;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  runtimeManifest: {
    schemaVersion: number;
    image: string;
    generatedAt: string;
  };
  hardware: {
    platform: string;
    arch: string;
    nodeVersion: string;
    cpuModel: string | null;
    logicalCpuCount: number;
    memoryBytes: number;
    accelerator: 'not-probed-by-benchmark';
  };
  profiles: BenchmarkProfileReport[];
  qualified: boolean;
  status: 'PASS' | 'FAIL';
  reportFile?: string;
}

export interface BenchmarkHumanRow {
  profile: string;
  status: 'PASS' | 'FAIL';
  positions: number;
  candidateMembership: string;
  firstAttemptSuccess: string;
  successAfterRetry: string;
  medianLatencyMs: number | null;
  commentarySamples: string;
  reportFile: string;
}

export interface BenchmarkDependencies {
  run(
    profileIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<BenchmarkReport>;
}

export interface InstalledBenchmarkOptions {
  paths: Pick<ChessLlamaPaths, 'benchmarksDir' | 'modelDir'>;
  manifest: RuntimeManifest;
  profileIds: readonly string[];
  now?: () => Date;
  signal?: AbortSignal;
  fixtures?: readonly BenchmarkFixture[];
  prepareProfile?: (profileId: string, signal?: AbortSignal) => Promise<void>;
  loadedModelId?: (signal?: AbortSignal) => Promise<string>;
  runProfile?: (
    profile: RuntimeProfile,
    fixtures: readonly BenchmarkFixture[],
    signal?: AbortSignal,
  ) => Promise<BenchmarkProfileReport>;
  hashFile?: (path: string, signal?: AbortSignal) => Promise<string>;
}

export function aggregateBenchmarkResults(
  positions: readonly BenchmarkPositionResult[],
): BenchmarkSummary {
  const validSelections = positions.filter((position) =>
    isCandidateSelection(position),
  );
  const firstAttempt = validSelections.filter(
    (position) => position.selection?.retryCount === 0,
  );
  const latencies = positions
    .flatMap((position) =>
      position.selection === null ? [] : [position.selection.latencyMs],
    )
    .sort((left, right) => left - right);
  const total = positions.length;

  const candidateMembership = fraction(validSelections.length, total);
  const firstAttemptSuccess = fraction(firstAttempt.length, total);
  const successAfterRetry = fraction(validSelections.length, total);
  const medianLatencyMs = median(latencies);

  const qualified =
    candidateMembership === 1 &&
    firstAttemptSuccess >= 0.95 &&
    successAfterRetry === 1 &&
    medianLatencyMs !== null &&
    medianLatencyMs < 3_000;

  return {
    totalPositions: total,
    candidateMembership,
    firstAttemptSuccess,
    successAfterRetry,
    medianLatencyMs,
    commentarySamples: positions.flatMap((position) =>
      position.selection === null ? [] : [position.selection.commentary],
    ),
    qualified,
    status: qualified ? 'PASS' : 'FAIL',
  };
}

export function benchmarkHumanRows(
  report: BenchmarkReport,
): BenchmarkHumanRow[] {
  return report.profiles.map(({ profileId, summary }) => ({
    profile: profileId,
    status: summary.status,
    positions: summary.totalPositions,
    candidateMembership: percent(summary.candidateMembership),
    firstAttemptSuccess: percent(summary.firstAttemptSuccess),
    successAfterRetry: percent(summary.successAfterRetry),
    medianLatencyMs: summary.medianLatencyMs,
    commentarySamples: summary.commentarySamples.join(' | '),
    reportFile: report.reportFile ?? '',
  }));
}

export async function runInstalledBenchmarks(
  options: InstalledBenchmarkOptions,
): Promise<BenchmarkReport> {
  const profiles = selectProfiles(options.manifest, options.profileIds);
  const fixtures = loadFixtures(options.fixtures ?? benchmarkFixtureData);
  const reports: BenchmarkProfileReport[] = [];

  for (const profile of profiles) {
    await requireModelFile(
      options.paths.modelDir,
      profile,
      options.hashFile ?? sha256File,
      options.signal,
    );
    await options.prepareProfile?.(profile.id, options.signal);
    const loadedModelId = await (options.loadedModelId ?? queryLoadedModelId)(
      options.signal,
    );
    if (loadedModelId !== profile.file) {
      throw new CliFailure(
        `llama.cpp loaded ${loadedModelId}, expected ${profile.file}`,
        exitCodes.health,
      );
    }
    const result = await (options.runProfile ?? runProfileBenchmark)(
      profile,
      fixtures,
      options.signal,
    );
    reports.push({
      ...result,
      profileId: profile.id,
      artifact: artifactFor(profile),
    });
  }

  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const qualified =
    reports.length > 0 && reports.every((item) => item.summary.qualified);
  const report: BenchmarkReport = {
    schemaVersion: 1,
    generatedAt,
    runtimeManifest: {
      schemaVersion: options.manifest.schemaVersion,
      image: options.manifest.image,
      generatedAt: options.manifest.generatedAt,
    },
    hardware: {
      platform,
      arch,
      nodeVersion,
      cpuModel: cpus()[0]?.model ?? null,
      logicalCpuCount: cpus().length,
      memoryBytes: totalmem(),
      accelerator: 'not-probed-by-benchmark',
    },
    profiles: reports,
    qualified,
    status: qualified ? 'PASS' : 'FAIL',
  };
  await mkdir(options.paths.benchmarksDir, { recursive: true });
  const reportFile = join(
    options.paths.benchmarksDir,
    `benchmark-${generatedAt.replace(/[:.]/gu, '-')}.json`,
  );
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { ...report, reportFile };
}

async function runProfileBenchmark(
  profile: RuntimeProfile,
  fixtures: readonly BenchmarkFixture[],
  signal?: AbortSignal,
): Promise<BenchmarkProfileReport> {
  const analyzer = await StockfishJsAnalyzer.create();
  const selector = new LlamaCppClient({
    modelId: profile.file,
    profileId: profile.id,
    quantization: profile.quantization,
    backend: 'CUDA',
  });
  try {
    const positions: BenchmarkPositionResult[] = [];
    for (const fixture of fixtures) {
      signal?.throwIfAborted();
      const chess = reconstructGame([], fixture.fen);
      const candidates = await analyzer.analyze({
        fen: fixture.fen,
        legalMoves: legalMoves(chess),
        candidateLimit: CANDIDATE_LIMIT,
        moveTimeMs: MOVE_TIME_MS,
        maxLossCp: MAX_CANDIDATE_LOSS_CP,
        signal,
      });
      try {
        const selection = await selector.selectMove({
          fen: fixture.fen,
          sanHistory: [],
          candidates,
          commentaryStyle: 'concise',
          modelProfileId: profile.id,
          signal,
        });
        if (selection.modelId !== profile.file) {
          throw new Error(
            `llama.cpp response model changed to ${selection.modelId}; expected ${profile.file}`,
          );
        }
        positions.push({
          id: fixture.id,
          category: fixture.category,
          candidates: candidates.map((candidate) => candidate.uci),
          selection: {
            uci: selection.uci,
            commentary: selection.commentary,
            modelId: selection.modelId,
            latencyMs: selection.latencyMs,
            promptTokens: selection.promptTokens,
            completionTokens: selection.completionTokens,
            tokensPerSecond: selection.tokensPerSecond,
            retryCount: selection.retryCount,
          },
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        positions.push({
          id: fixture.id,
          category: fixture.category,
          candidates: candidates.map((candidate) => candidate.uci),
          selection: null,
          error: messageFor(error),
        });
      }
    }
    return {
      profileId: profile.id,
      artifact: artifactFor(profile),
      positions,
      summary: aggregateBenchmarkResults(positions),
    };
  } finally {
    await analyzer.close();
  }
}

function loadFixtures(value: unknown): BenchmarkFixture[] {
  if (!isFixtureArray(value)) {
    throw new CliFailure('Benchmark fixture is invalid', exitCodes.input);
  }
  return value;
}

async function requireModelFile(
  modelDir: string,
  profile: RuntimeProfile,
  hashFile: (path: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<void> {
  const modelPath = join(modelDir, profile.file);
  try {
    await access(modelPath, constants.R_OK);
  } catch (error) {
    throw new CliFailure(
      `Model weights are missing for profile ${profile.id}; run chess-llama model pull --profile ${profile.id}`,
      exitCodes.prerequisite,
      { cause: error },
    );
  }
  if ((await hashFile(modelPath, signal)) !== profile.sha256) {
    throw new CliFailure(
      `Model checksum mismatch for profile ${profile.id}; run chess-llama model pull --profile ${profile.id}`,
      exitCodes.prerequisite,
    );
  }
}

async function queryLoadedModelId(signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(5_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await globalThis.fetch('http://127.0.0.1:8080/v1/models', {
      signal: requestSignal,
    });
  } catch (error) {
    throw new CliFailure(
      'Unable to query the loaded llama.cpp model',
      exitCodes.health,
      {
        cause: error,
      },
    );
  }
  if (!response.ok) {
    throw new CliFailure(
      `llama.cpp model discovery returned HTTP ${response.status}`,
      exitCodes.health,
    );
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new CliFailure(
      'llama.cpp returned invalid model discovery data',
      exitCodes.health,
    );
  }
  const first: unknown = body.data[0];
  if (!isRecord(first) || typeof first.id !== 'string') {
    throw new CliFailure(
      'llama.cpp did not report a loaded model',
      exitCodes.health,
    );
  }
  return first.id;
}

function artifactFor(profile: RuntimeProfile): BenchmarkProfileArtifact {
  return {
    id: profile.id,
    repository: profile.repository,
    revision: profile.source.revision,
    file: profile.file,
    sha256: profile.sha256,
    quantization: profile.quantization,
    contextSize: profile.contextSize,
    experimental: profile.experimental ?? false,
  };
}

function selectProfiles(
  manifest: RuntimeManifest,
  requested: readonly string[],
): RuntimeProfile[] {
  const ids = requested.length === 0 ? [manifest.profiles[0]?.id] : requested;
  const profiles = ids.map((id) =>
    manifest.profiles.find((profile) => profile.id === id),
  );
  if (profiles.some((profile) => profile === undefined)) {
    throw new CliFailure('Unknown benchmark model profile', exitCodes.input);
  }
  return profiles as RuntimeProfile[];
}

function isCandidateSelection(position: BenchmarkPositionResult): boolean {
  return (
    position.selection !== null &&
    position.candidates.includes(position.selection.uci)
  );
}

function fraction(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] ?? null;
  const left = values[middle - 1];
  const right = values[middle];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

function isFixture(value: unknown): value is BenchmarkFixture {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'category' in value &&
    'fen' in value &&
    typeof value.id === 'string' &&
    typeof value.category === 'string' &&
    typeof value.fen === 'string'
  );
}

function isFixtureArray(value: unknown): value is BenchmarkFixture[] {
  return Array.isArray(value) && value.every((item) => isFixture(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sha256File(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash('sha256');
  const stream: AsyncIterable<unknown> = createReadStream(path, { signal });
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk))
      throw new Error(`Unexpected data while hashing ${path}`);
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function readStdin(): Promise<string> {
  let source = '';
  for await (const chunk of process.stdin) source += String(chunk);
  return source;
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation === 'rows') {
    const report = JSON.parse(await readStdin()) as BenchmarkReport;
    process.stdout.write(`${JSON.stringify(benchmarkHumanRows(report))}\n`);
    return;
  }
  if (operation !== 'run') {
    throw new CliFailure(
      `Unknown benchmark operation: ${operation ?? ''}`,
      exitCodes.input,
    );
  }

  const projectRoot = process.env.CHESS_LLAMA_PROJECT_ROOT;
  const manifestFile = process.env.CHESS_LLAMA_RUNTIME_MANIFEST;
  const modelDir = process.env.CHESS_LLAMA_MODEL_DIR;
  const benchmarksDir = process.env.CHESS_LLAMA_BENCHMARKS_DIR;
  if (!projectRoot || !manifestFile || !modelDir || !benchmarksDir) {
    throw new CliFailure(
      'Benchmark environment is incomplete',
      exitCodes.prerequisite,
    );
  }
  const manifest = await loadRuntimeManifest(manifestFile);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const report = await runInstalledBenchmarks({
      paths: { modelDir, benchmarksDir },
      manifest,
      profileIds: process.argv.slice(3),
      signal: controller.signal,
      prepareProfile: async (profileId, signal) => {
        try {
          await execFileAsync(
            resolve(projectRoot, 'chess-llama'),
            ['model', 'start', '--profile', profileId],
            { cwd: projectRoot, env: process.env, signal },
          );
        } catch (error) {
          throw new CliFailure(
            `Unable to start benchmark profile ${profileId}`,
            exitCodes.runtime,
            { cause: error },
          );
        }
      },
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode =
      error instanceof CliFailure ? error.code : exitCodes.unexpected;
  });
}
