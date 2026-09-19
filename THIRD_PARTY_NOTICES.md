# Third-Party Notices

This file is generated deterministically from the production dependency graph locked by `pnpm-lock.yaml`. Regenerate it with `pnpm notices` and review changes before release.

## Runtime and model components

| Component | License | Source | Distribution note |
| --- | --- | --- | --- |
| llama.cpp CUDA server | MIT | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | Pulled as the immutable container digest recorded in `config/runtime-manifest.json`. |
| Qwen3-4B GGUF weights | Apache-2.0 | [Qwen/Qwen3-4B-GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF) | Downloaded on demand; not stored in this repository. |
| Qwen3-1.7B GGUF weights | Apache-2.0 | [ggml-org/Qwen3-1.7B-GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF) | Experimental profile downloaded on demand; not stored in this repository. |
| chess.js | BSD-2-Clause | [jhlywa/chess.js](https://github.com/jhlywa/chess.js) | Authoritative chess rules and notation. |
| react-chessboard | MIT | [Clariity/react-chessboard](https://github.com/Clariity/react-chessboard) | Browser chessboard rendering and interaction. |
| Stockfish | GPL-3.0 | [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish) | Engine source used by the Stockfish.js build. |
| Stockfish.js 18.0.8 | GPL-3.0 | [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) and [npm artifact](https://www.npmjs.com/package/stockfish/v/18.0.8) | The installed package includes `Copying.txt`, WASM, JavaScript, and build/source links. |

## GPL redistribution note

Chess Llama is distributed under GPL-3.0; the full license is in `LICENSE`. Stockfish and Stockfish.js are GPL-3.0 components. Anyone conveying a build that contains their JavaScript or WASM must preserve their copyright/license notices and provide the complete corresponding source and build information required by GPL-3.0. The exact npm version and upstream source locations are recorded above and in `pnpm-lock.yaml`.

## Locked production package inventory

### (BSD-2-Clause OR MIT OR Apache-2.0)

| Package | Version(s) | Project |
| --- | --- | --- |
| rc | 1.2.8 | [link](https://github.com/dominictarr/rc#readme) |

### (MIT OR WTFPL)

| Package | Version(s) | Project |
| --- | --- | --- |
| expand-template | 2.0.3 | [link](https://github.com/ralphtheninja/expand-template) |

### 0BSD

| Package | Version(s) | Project |
| --- | --- | --- |
| tslib | 2.8.1 | [link](https://www.typescriptlang.org/) |

### Apache-2.0

| Package | Version(s) | Project |
| --- | --- | --- |
| detect-libc | 2.1.2 | [link](https://github.com/lovell/detect-libc#readme) |
| drizzle-orm | 0.45.2 | [link](https://orm.drizzle.team) |
| tunnel-agent | 0.6.0 | [link](https://github.com/mikeal/tunnel-agent#readme) |

### BSD-2-Clause

| Package | Version(s) | Project |
| --- | --- | --- |
| chess.js | 1.4.0 | [link](https://github.com/jhlywa/chess.js) |

### BSD-3-Clause

| Package | Version(s) | Project |
| --- | --- | --- |
| fast-uri | 3.1.7, 4.1.4 | [link](https://github.com/fastify/fast-uri) |
| ieee754 | 1.2.1 | [link](https://github.com/feross/ieee754#readme) |
| light-my-request | 6.6.0 | [link](https://github.com/fastify/light-my-request#readme) |
| secure-json-parse | 4.1.0 | [link](https://github.com/fastify/secure-json-parse#readme) |

### GPL-3.0

| Package | Version(s) | Project |
| --- | --- | --- |
| stockfish | 18.0.8 | [link](https://github.com/nmrugg/stockfish.js#readme) |

### ISC

| Package | Version(s) | Project |
| --- | --- | --- |
| chownr | 1.1.4 | [link](https://github.com/isaacs/chownr#readme) |
| fastq | 1.20.3 | [link](https://github.com/mcollina/fastq#readme) |
| inherits | 2.0.4 | [link](https://github.com/isaacs/inherits#readme) |
| ini | 1.3.8 | [link](https://github.com/isaacs/ini#readme) |
| once | 1.4.0 | [link](https://github.com/isaacs/once#readme) |
| semver | 7.8.5 | [link](https://github.com/npm/node-semver#readme) |
| split2 | 4.2.0 | [link](https://github.com/mcollina/split2#readme) |
| wrappy | 1.0.2 | [link](https://github.com/npm/wrappy) |
| yaml | 2.9.1 | [link](https://eemeli.org/yaml/) |

### MIT

| Package | Version(s) | Project |
| --- | --- | --- |
| @dnd-kit/accessibility | 3.1.1 | [link](https://github.com/clauderic/dnd-kit#readme) |
| @dnd-kit/core | 6.3.1 | [link](https://github.com/clauderic/dnd-kit#readme) |
| @dnd-kit/modifiers | 9.0.0 | [link](https://github.com/clauderic/dnd-kit#readme) |
| @dnd-kit/utilities | 3.2.2 | [link](https://github.com/clauderic/dnd-kit#readme) |
| @fastify/ajv-compiler | 4.0.6 | [link](https://github.com/fastify/ajv-compiler#readme) |
| @fastify/error | 4.2.0 | [link](https://github.com/fastify/fastify-error#readme) |
| @fastify/fast-json-stringify-compiler | 5.1.0 | [link](https://github.com/fastify/fast-json-stringify-compiler#readme) |
| @fastify/forwarded | 3.0.2 | [link](https://github.com/fastify/forwarded#readme) |
| @fastify/merge-json-schemas | 0.2.1 | [link](https://github.com/fastify/merge-json-schemas#readme) |
| @fastify/proxy-addr | 5.1.0 | [link](https://github.com/fastify/proxy-addr#readme) |
| @fastify/swagger | 9.8.1 | [link](https://github.com/fastify/fastify-swagger#readme) |
| @pinojs/redact | 0.4.0 | [link](https://github.com/pinojs/redact#readme) |
| @tanstack/query-core | 5.102.8 | [link](https://tanstack.com/query) |
| @tanstack/react-query | 5.102.8 | [link](https://tanstack.com/query) |
| abstract-logging | 2.0.1 | [link](https://github.com/jsumners/abstract-logging#readme) |
| ajv | 8.20.0 | [link](https://ajv.js.org) |
| ajv-formats | 3.0.1 | [link](https://github.com/ajv-validator/ajv-formats#readme) |
| atomic-sleep | 1.0.0 | [link](https://github.com/davidmarkclements/atomic-sleep#readme) |
| avvio | 9.3.0 | [link](https://github.com/fastify/avvio#readme) |
| base64-js | 1.5.1 | [link](https://github.com/beatgammit/base64-js) |
| better-sqlite3 | 12.11.1 | [link](http://github.com/WiseLibs/better-sqlite3) |
| bindings | 1.5.0 | [link](https://github.com/TooTallNate/node-bindings) |
| bl | 4.1.0 | [link](https://github.com/rvagg/bl) |
| buffer | 5.7.1 | [link](https://github.com/feross/buffer) |
| cookie | 1.1.1 | [link](https://github.com/jshttp/cookie#readme) |
| debug | 4.4.3 | [link](https://github.com/debug-js/debug#readme) |
| decompress-response | 6.0.0 | [link](https://github.com/sindresorhus/decompress-response#readme) |
| deep-extend | 0.6.0 | [link](https://github.com/unclechu/node-deep-extend) |
| dequal | 2.0.3 | [link](https://github.com/lukeed/dequal#readme) |
| end-of-stream | 1.4.5 | [link](https://github.com/mafintosh/end-of-stream) |
| fast-decode-uri-component | 1.0.1 | [link](https://github.com/delvedor/fast-decode-uri-component#readme) |
| fast-deep-equal | 3.1.3 | [link](https://github.com/epoberezkin/fast-deep-equal#readme) |
| fast-json-stringify | 7.0.1 | [link](https://github.com/fastify/fast-json-stringify#readme) |
| fast-querystring | 1.1.2 | [link](https://github.com/anonrig/fast-querystring#readme) |
| fastify | 5.12.4 | [link](https://fastify.dev/) |
| fastify-plugin | 6.0.0 | [link](https://github.com/fastify/fastify-plugin#readme) |
| fastify-type-provider-zod | 6.1.0 | [link](https://github.com/turkerdev/fastify-type-provider-zod) |
| file-uri-to-path | 1.0.0 | [link](https://github.com/TooTallNate/file-uri-to-path) |
| find-my-way | 9.9.0 | [link](https://github.com/delvedor/find-my-way#readme) |
| fs-constants | 1.0.0 | [link](https://github.com/mafintosh/fs-constants) |
| github-from-package | 0.0.0 | [link](https://github.com/substack/github-from-package) |
| ipaddr.js | 2.5.0 | [link](https://github.com/whitequark/ipaddr.js#readme) |
| json-schema-ref-resolver | 3.0.0 | [link](https://github.com/fastify/json-schema-ref-resolver#readme) |
| json-schema-resolver | 3.0.0 | [link](https://github.com/Eomm/json-schema-resolver#readme) |
| json-schema-traverse | 1.0.0 | [link](https://github.com/epoberezkin/json-schema-traverse#readme) |
| mimic-response | 3.1.0 | [link](https://github.com/sindresorhus/mimic-response#readme) |
| minimist | 1.2.8 | [link](https://github.com/minimistjs/minimist) |
| mkdirp-classic | 0.5.3 | [link](https://github.com/mafintosh/mkdirp-classic) |
| ms | 2.1.3 | [link](https://github.com/vercel/ms#readme) |
| napi-build-utils | 2.0.0 | [link](https://github.com/inspiredware/napi-build-utils#readme) |
| node-abi | 3.96.0 | [link](https://github.com/electron/node-abi#readme) |
| on-exit-leak-free | 2.1.2 | [link](https://github.com/mcollina/on-exit-or-gc#readme) |
| openapi-types | 12.1.3 | [link](https://github.com/kogosoftwarellc/open-api/tree/master/packages/openapi-types#readme) |
| pino | 10.3.1 | [link](https://getpino.io) |
| pino-abstract-transport | 3.0.0 | [link](https://github.com/pinojs/pino-abstract-transport#readme) |
| pino-std-serializers | 7.1.0 | [link](https://github.com/pinojs/pino-std-serializers#readme) |
| prebuild-install | 7.1.3 | [link](https://github.com/prebuild/prebuild-install) |
| process-warning | 4.0.1, 5.1.0 | [link](https://github.com/fastify/fastify-warning#readme) |
| pump | 3.0.4 | [link](https://github.com/mafintosh/pump#readme) |
| quick-format-unescaped | 4.0.4 | [link](https://github.com/davidmarkclements/quick-format#readme) |
| react | 19.3.0 | [link](https://react.dev/) |
| react-chessboard | 5.12.1 | [link](https://github.com/Clariity/react-chessboard#readme) |
| react-dom | 19.3.0 | [link](https://react.dev/) |
| react-router | 7.18.3 | [link](https://github.com/remix-run/react-router#readme) |
| react-router-dom | 7.18.3 | [link](https://github.com/remix-run/react-router#readme) |
| readable-stream | 3.6.2 | [link](https://github.com/nodejs/readable-stream#readme) |
| real-require | 0.2.0, 1.0.0 | [link](https://github.com/pinojs/real-require) |
| require-from-string | 2.0.2 | [link](https://github.com/floatdrop/require-from-string#readme) |
| ret | 0.5.0 | [link](https://github.com/fent/ret.js#readme) |
| reusify | 1.1.0 | [link](https://github.com/mcollina/reusify#readme) |
| rfdc | 1.4.1 | [link](https://github.com/davidmarkclements/rfdc#readme) |
| safe-buffer | 5.2.1 | [link](https://github.com/feross/safe-buffer) |
| safe-regex2 | 5.1.1 | [link](https://github.com/fastify/safe-regex2) |
| safe-stable-stringify | 2.5.0 | [link](https://github.com/BridgeAR/safe-stable-stringify#readme) |
| scheduler | 0.28.0 | [link](https://react.dev/) |
| set-cookie-parser | 2.7.2 | [link](https://github.com/nfriedly/set-cookie-parser) |
| simple-concat | 1.0.1 | [link](https://github.com/feross/simple-concat) |
| simple-get | 4.0.1 | [link](https://github.com/feross/simple-get) |
| sonic-boom | 4.2.1 | [link](https://github.com/pinojs/sonic-boom#readme) |
| string_decoder | 1.3.0 | [link](https://github.com/nodejs/string_decoder) |
| strip-json-comments | 2.0.1 | [link](https://github.com/sindresorhus/strip-json-comments#readme) |
| tar-fs | 2.1.5 | [link](https://github.com/mafintosh/tar-fs) |
| tar-stream | 2.2.0 | [link](https://github.com/mafintosh/tar-stream) |
| thread-stream | 4.2.0 | [link](https://github.com/mcollina/thread-stream#readme) |
| toad-cache | 3.7.4 | [link](https://github.com/kibertoad/toad-cache) |
| util-deprecate | 1.0.2 | [link](https://github.com/TooTallNate/util-deprecate) |
| zod | 4.6.5 | [link](https://zod.dev) |

