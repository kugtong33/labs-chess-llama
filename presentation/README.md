# Local LLMs presentation

This directory contains the editable source, licensed media, speaker notes, and
four generated deliverables for the 20-minute talk **“Local LLMs: My 8GB VRAM
vs the World.”**

## Build

Docker is the only host dependency:

```bash
./presentation/build.sh all
./presentation/build.sh render
```

Outputs are written to `presentation/deliverables/`; rendered review images and a
contact sheet are written to `presentation/rendered/`.

## Presenting

The core talk is slides 1–14. Slides 15–16 are source and media-credit
appendices. Every slide has speaker notes. Replace the presenter placeholder on
slide 1, then rehearse to roughly these beats:

- Context and thesis, slides 1–3: 3 minutes
- Computing-history analogy, slides 4–7: 5 minutes
- Why and how local models work, slides 8–11: 6 minutes
- Chess Llama pipeline and live demo, slides 12–13: 4 minutes
- Close, slide 14: 2 minutes

For the live demo, run `./chess-llama doctor`, preload the model, and start the
application before presenting. Slide 13 is the visual fallback if the live demo
cannot run.

## Sources and licensing

The deck's factual citations are stored in `src/content.json` and included in
speaker notes. Full image URLs, licenses, file hashes, and alteration notes are
in [`assets/ATTRIBUTION.md`](assets/ATTRIBUTION.md). Logo use is nominative and
does not imply sponsorship.
