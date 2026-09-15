# Local llama.cpp Chess Showcase: Feasibility Research

**Date:** 2026-09-15  
**Verdict:** Feasible as a local, open-source showcase. Use a hybrid opponent in which Stockfish shortlists credible moves and a quantized model running through llama.cpp chooses the final move and writes the commentary.

## Findings

### llama.cpp is suitable as the local inference runtime

`llama-server` provides an HTTP server with OpenAI-compatible chat-completion endpoints, health checks, model information, CUDA acceleration, and schema-constrained JSON responses. Its JSON Schema support includes enum-constrained string fields, which lets the gateway restrict model output to the exact candidate moves for the current position.

The official project publishes CUDA 12 and CUDA 13 server container images for Linux AMD64. A container can expose the server only on loopback while using `--gpus all` and offloading all model layers to the RTX 4060. NVIDIA documents CUDA and Docker support in WSL2, so the same container strategy works for both target environments.

Sources:

- [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [llama.cpp structured-output tests](https://github.com/ggml-org/llama.cpp/blob/master/scripts/server-test-structured.py)
- [llama.cpp Docker images](https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md)
- [NVIDIA CUDA on WSL guide](https://docs.nvidia.com/cuda/wsl-user-guide/)

### Model and GPU fit

The desktop GeForce RTX 4060 has 8 GB of GDDR6 VRAM. Qwen3-4B Q4_K_M is approximately 2.5 GB, leaving enough VRAM for a 4,096-token context, CUDA buffers, and the operating environment. It is the default smallest-credible profile. Qwen3-1.7B Q4_K_M is approximately 1.1 GB and remains an experimental low-footprint profile pending the project benchmark.

Both model repositories are Apache-2.0 licensed and publish GGUF weights that llama.cpp can download directly.

Sources:

- [NVIDIA RTX 4060 specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4060-4060ti/)
- [Qwen3-4B GGUF model card](https://huggingface.co/Qwen/Qwen3-4B-GGUF)
- [Qwen3-1.7B GGUF repository](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF)

### A pure small LLM is not a credible chess engine

Chess benchmarks report that general-purpose language models can make illegal moves, lose track of state, and struggle to complete games. Grammar-constrained output solves legality but does not guarantee strategic quality. The selected hybrid design therefore uses Stockfish to produce a credible shortlist and llama.cpp to make the final choice. This preserves meaningful model agency without presenting a 4B language model as a conventional chess engine.

Sources:

- [LLM CHESS benchmark](https://arxiv.org/abs/2512.01992)
- [Large Language Models on the Chessboard](https://arxiv.org/abs/2308.15118)
- [Stockfish project](https://github.com/official-stockfish/Stockfish)

### Open-source chess components are available

`chess.js` provides browser- and Node-compatible move generation, validation, FEN/PGN handling, and end-state detection. `react-chessboard` provides a responsive React board. Stockfish.js 18 provides a Node-compatible WASM engine; its lite single-threaded build is about 7 MB and is sufficient for shortlisting.

The project will use GPL-3.0 because Stockfish and Stockfish.js are GPL-3.0. llama.cpp and react-chessboard are MIT, chess.js is BSD-2-Clause, and the Qwen weights are Apache-2.0; these components can be distributed within a GPL-3.0 project when their notices and terms are preserved.

Sources:

- [chess.js](https://github.com/jhlywa/chess.js)
- [react-chessboard](https://github.com/Clariity/react-chessboard)
- [Stockfish.js](https://github.com/nmrugg/stockfish.js)
- [llama.cpp license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE)

## Approaches Considered

| Approach | Advantages | Disadvantages | Decision |
| --- | --- | --- | --- |
| Pure LLM over all legal moves | Most direct llama.cpp demonstration | Strategically unreliable with small models | Rejected for MVP |
| Stockfish shortlist, LLM final choice | Credible moves, visible LLM agency, small model viable | Requires a second inference component and GPL-3.0 | Selected |
| Stockfish chooses, LLM comments | Strongest play | llama.cpp is not meaningfully the opponent | Rejected |
| Browser calls llama-server directly | Minimal services | Leaks model protocol and prompts into UI; weak persistence boundary | Rejected |
| Gateway translates chess turns to llama.cpp | Stable client API, centralized validation and persistence | Adds one local process | Selected |
| Full Lichess fork | Mature chess platform | Far beyond MVP scope; Scala, MongoDB, Redis, AGPL/GPL surface | Rejected |

## Main Risks and Mitigations

- **Small-model quality:** benchmark both quantized profiles on committed positions; keep 4B as the default unless 1.7B meets the same gate.
- **llama.cpp structured-output variation:** pin the container digest, constrain with JSON Schema, validate again with chess.js, and retry once.
- **Model or container failure:** persist the human move before inference and retain an `awaiting_ai` state that can be retried after restart.
- **Misleading showcase claims:** disclose in the UI that Stockfish shortlists and llama.cpp makes the final choice and commentary.
- **CUDA differences between Linux and WSL2:** provide `chess-llama doctor` and test GPU access inside the exact pinned container.
- **Mutable external artifacts:** maintain a runtime manifest containing container digest, model repository, quantization, and verified model checksum.

## Recommendation

Build the greenfield TypeScript monorepo specified in the companion design document. Keep all services loopback-only, use the official llama.cpp CUDA container, default to Qwen3-4B Q4_K_M, persist game state in SQLite, and expose every operational layer through one namespaced `chess-llama` CLI.
