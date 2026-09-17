# Model Qualification

The benchmark answers a narrow question: can an installed quantized model reliably choose a legal, Stockfish-shortlisted move and produce reviewable commentary quickly enough on the target machine? It does not assign Elo, prove tactical strength, or automate a claim that prose is semantically correct.

## Run it

Install the selected model, then run:

```bash
./chess-llama model benchmark --profile qwen3-4b-q4-k-m --format human
```

Repeat `--profile` to qualify multiple installed profiles in one run. Before each profile, the command verifies the installed GGUF checksum, starts or recreates the managed llama.cpp container for that profile, and confirms `/v1/models` reports the exact expected filename. JSON format is available for tooling. A timestamped report is written to `${XDG_DATA_HOME:-~/.local/share}/chess-llama/benchmarks/` (or `CHESS_LLAMA_BENCHMARKS_DIR`). Missing or corrupt weights exit `3`, a loaded-model mismatch exits `5`, and a completed but failed qualification exits `1`.

Each committed position is analyzed sequentially through the same Stockfish.js and llama.cpp adapters used in gameplay. The suite covers opening positions, castling, en passant, promotion, forced mate, a rook endgame, and positional play. Sequential execution avoids counting queue delay from artificial concurrent requests against a one-slot llama.cpp server.

## Automated PASS gates

A profile prints `PASS` only when all four conditions hold:

1. Candidate membership is exactly 100%: every returned move belongs to the dynamic Stockfish candidate enum.
2. First-attempt success is at least 95%.
3. Success after the adapter's one bounded retry is exactly 100%.
4. Median end-to-end llama.cpp selection latency is below 3000 ms.

With the current eight-position fixture, the 95% first-attempt threshold effectively requires all eight first attempts to succeed. Reports include each profile's immutable repository, revision, filename, SHA-256, quantization, and context size together with the runtime image identity, host CPU/memory summary, candidate UCIs, choice, commentary, latency, prompt/completion token counts, tokens per second, retry count, and errors. The report deliberately marks the accelerator as `not-probed-by-benchmark`; use `doctor` to record the actual Docker/CUDA environment alongside the report.

## Required human commentary review

An automated PASS is necessary but not sufficient. Review every commentary sample and record reviewer, date, profile, report filename, GPU/driver, and the following decisions:

- The text accurately describes the selected move or its immediate purpose.
- It does not claim a tactic, check, capture, or forced result that is absent.
- It is concise, intelligible, and appropriate for the configured style.
- It contains no hidden chain-of-thought, prompt fragments, JSON debris, or unrelated content.
- Repeated samples are not so generic that the llama.cpp showcase becomes misleading.
- The complete browser game remains usable after host network access is disabled.

Use `PASS`, `FAIL`, or `NEEDS FOLLOW-UP` for each line and preserve the completed review next to the JSON report. Do not edit the generated JSON report.

## Profile policy

`qwen3-4b-q4-k-m` remains the recommended default for the RTX 4060 until a later profile demonstrates a better quality/resource tradeoff. `qwen3-1.7b-q4-k-m` is experimental. It may become the default only after independently passing every automated gate and the human checklist on target hardware; merely producing legal JSON is not enough.

Normal CI does not run this hardware benchmark. CI exercises aggregation, CLI exit behavior, real protocol translation against a deterministic fake server, browser recovery, and SQLite persistence without Docker, GPU, model weights, or downloads.
