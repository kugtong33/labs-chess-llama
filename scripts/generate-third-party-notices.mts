import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

interface LicensePackage {
  name: string;
  versions: string[];
  homepage?: string;
}

type LicenseInventory = Record<string, LicensePackage[]>;

const { stdout } = await execFileAsync(
  'pnpm',
  ['licenses', 'list', '--json', '--prod'],
  { maxBuffer: 10 * 1024 * 1024 },
);
const inventory = parseInventory(stdout);
const lines = [
  '# Third-Party Notices',
  '',
  'This file is generated deterministically from the production dependency graph locked by `pnpm-lock.yaml`. Regenerate it with `pnpm notices` and review changes before release.',
  '',
  '## Runtime and model components',
  '',
  '| Component | License | Source | Distribution note |',
  '| --- | --- | --- | --- |',
  '| llama.cpp CUDA server | MIT | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | Pulled as the immutable container digest recorded in `config/runtime-manifest.json`. |',
  '| Qwen3-4B GGUF weights | Apache-2.0 | [Qwen/Qwen3-4B-GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF) | Downloaded on demand; not stored in this repository. |',
  '| Qwen3-1.7B GGUF weights | Apache-2.0 | [ggml-org/Qwen3-1.7B-GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF) | Experimental profile downloaded on demand; not stored in this repository. |',
  '| chess.js | BSD-2-Clause | [jhlywa/chess.js](https://github.com/jhlywa/chess.js) | Authoritative chess rules and notation. |',
  '| react-chessboard | MIT | [Clariity/react-chessboard](https://github.com/Clariity/react-chessboard) | Browser chessboard rendering and interaction. |',
  '| Stockfish | GPL-3.0 | [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish) | Engine source used by the Stockfish.js build. |',
  '| Stockfish.js 18.0.8 | GPL-3.0 | [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) and [npm artifact](https://www.npmjs.com/package/stockfish/v/18.0.8) | The installed package includes `Copying.txt`, WASM, JavaScript, and build/source links. |',
  '',
  '## GPL redistribution note',
  '',
  'Chess Llama is distributed under GPL-3.0; the full license is in `LICENSE`. Stockfish and Stockfish.js are GPL-3.0 components. Anyone conveying a build that contains their JavaScript or WASM must preserve their copyright/license notices and provide the complete corresponding source and build information required by GPL-3.0. The exact npm version and upstream source locations are recorded above and in `pnpm-lock.yaml`.',
  '',
  '## Locked production package inventory',
  '',
];

for (const license of Object.keys(inventory).sort(compare)) {
  const dependencies = inventory[license];
  if (dependencies === undefined) continue;
  lines.push(`### ${escapeMarkdown(license)}`, '');
  lines.push('| Package | Version(s) | Project |', '| --- | --- | --- |');
  for (const dependency of [...dependencies].sort((left, right) =>
    compare(left.name, right.name),
  )) {
    const homepage = dependency.homepage
      ? `[link](${dependency.homepage})`
      : '—';
    lines.push(
      `| ${escapeMarkdown(dependency.name)} | ${dependency.versions
        .slice()
        .sort(compare)
        .map(escapeMarkdown)
        .join(', ')} | ${homepage} |`,
    );
  }
  lines.push('');
}

await writeFile('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}\n`, 'utf8');

function parseInventory(value: string): LicenseInventory {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed))
    throw new Error('pnpm returned an invalid license inventory');
  const result: LicenseInventory = {};
  for (const [license, packages] of Object.entries(parsed)) {
    if (!Array.isArray(packages)) {
      throw new Error(`Invalid package list for license ${license}`);
    }
    result[license] = packages.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.name !== 'string' ||
        !Array.isArray(item.versions) ||
        item.versions.some((version) => typeof version !== 'string') ||
        (item.homepage !== undefined && typeof item.homepage !== 'string')
      ) {
        throw new Error(`Invalid package entry for license ${license}`);
      }
      return {
        name: item.name,
        versions: item.versions as string[],
        ...(item.homepage === undefined ? {} : { homepage: item.homepage }),
      };
    });
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('|', '\\|');
}
