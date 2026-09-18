#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
image_name=chess-llama-presentation:local
output_stem=local-llms-my-8gb-vram-vs-world
deliverables=(
  local-llms-my-8gb-vram-vs-world.pptx
  local-llms-my-8gb-vram-vs-world.odp
  local-llms-my-8gb-vram-vs-world.pdf
  local-llms-my-8gb-vram-vs-world.ppt
)

usage() {
  printf 'Usage: %s {all|verify|render}\n' "$0"
}

run_container() {
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/presentation-home \
    -v "$script_dir:/work" \
    -w /work \
    "$image_name" "$@"
}

build_all() {
  docker build -t "$image_name" "$script_dir"
  run_container node src/deck.mjs
  run_container bash src/export.sh "$output_stem"
  run_container python3 src/verify.py \
    "deliverables/$output_stem.pptx" \
    "deliverables/$output_stem.odp" \
    "deliverables/$output_stem.pdf" \
    "deliverables/$output_stem.ppt"
}

verify_all() {
  verify_paths=()
  for deliverable in "${deliverables[@]}"; do
    verify_paths+=("deliverables/$deliverable")
  done
  run_container python3 src/verify.py "${verify_paths[@]}"
}

render_all() {
  run_container bash src/render.sh "$output_stem"
}

case "${1:-}" in
  all) build_all ;;
  verify) verify_all ;;
  render) render_all ;;
  *) usage; exit 2 ;;
esac
