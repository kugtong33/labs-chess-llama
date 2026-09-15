import { ZodError } from 'zod';

import type { Output } from './dependencies.js';

export const exitCodes = {
  unexpected: 1,
  input: 2,
  prerequisite: 3,
  runtime: 4,
  health: 5,
  storage: 6,
} as const;

export function parseOutputFormat(value: string | undefined): 'json' | 'human' {
  const format = value ?? 'json';
  if (format === 'json' || format === 'human') return format;
  throw new CliFailure(`Unsupported output format: ${format}`, exitCodes.input);
}

export function createOutput(
  stdout: (text: string) => void = (text) => process.stdout.write(text),
  stderr: (text: string) => void = (text) => process.stderr.write(text),
): Output {
  return {
    write(value, format = 'json') {
      if (format === 'human') {
        stdout(formatHuman(value));
      } else stdout(`${JSON.stringify(value)}\n`);
    },
    error(value) {
      stderr(`${value instanceof Error ? value.message : String(value)}\n`);
    },
  };
}

function formatHuman(value: unknown): string {
  if (isRecord(value) && Array.isArray(value.checks)) {
    const summary = Object.entries(value)
      .filter(([key]) => key !== 'checks')
      .map(([key, item]) => `${key.padEnd(18)} ${display(item)}`);
    return `${[...summary, renderRows(value.checks)].filter(Boolean).join('\n')}\n`;
  }
  if (Array.isArray(value)) return `${renderRows(value)}\n`;
  if (isRecord(value)) {
    return `${Object.entries(value)
      .map(([key, item]) => `${key.padEnd(18)} ${display(item)}`)
      .join('\n')}\n`;
  }
  return `${display(value)}\n`;
}

function renderRows(values: unknown[]): string {
  const rows = values.filter(isRecord);
  if (rows.length === 0) return '';
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => display(row[key]).length)),
  );
  const render = (row: Record<string, unknown>) =>
    keys
      .map((key, index) => display(row[key]).padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  const header = Object.fromEntries(keys.map((key) => [key, key]));
  return [render(header), ...rows.map(render)].join('\n');
}

function display(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);
}

export class CliFailure extends Error {
  public constructor(
    message: string,
    public readonly code: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class PassthroughExit extends Error {
  public constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
  }
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof CliFailure) return error.code;
  if (error instanceof ZodError) return exitCodes.input;
  if (isCommanderInputError(error)) return exitCodes.input;
  if (error instanceof PassthroughExit) return error.exitCode;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('health')) return exitCodes.health;
  if (
    message.includes('migration') ||
    message.includes('sqlite') ||
    message.includes('database')
  )
    return exitCodes.storage;
  if (
    message.includes('docker') ||
    message.includes('not installed') ||
    message.includes('prerequisite')
  )
    return exitCodes.prerequisite;
  if (message.includes('start') || message.includes('runtime'))
    return exitCodes.runtime;
  return exitCodes.unexpected;
}

export async function asCliFailure<T>(
  operation: Promise<T>,
  code: number,
  message: string,
): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw new CliFailure(message, code, { cause: error });
  }
}

function isCommanderInputError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    value.code.startsWith('commander.')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
