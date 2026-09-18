#!/usr/bin/env bash
set -euo pipefail

stem=${1:?output stem is required}
render_dir="rendered/$stem"
thumb_dir="$render_dir/thumbs"

mkdir -p "$render_dir" "$thumb_dir"
pdftoppm -png -r 110 "deliverables/$stem.pdf" "$render_dir/slide"

for source in "$render_dir"/slide-*.png; do
  filename=$(basename "$source")
  convert "$source" \
    -thumbnail 360x203 \
    -background '#171a16' \
    -gravity center \
    -extent 384x227 \
    "$thumb_dir/$filename"
done

slides=("$render_dir"/slide-*.png)
slide_count=${#slides[@]}
row_count=$(((slide_count + 3) / 4))
rows=()

for ((row = 0; row < row_count; row += 1)); do
  first=$((row * 4 + 1))
  row_images=()
  for ((column = 0; column < 4; column += 1)); do
    slide_number=$((first + column))
    if ((slide_number <= slide_count)); then
      printf -v slide_name 'slide-%02d.png' "$slide_number"
      row_images+=("$thumb_dir/$slide_name")
    fi
  done
  row_path="$thumb_dir/row-$row.png"
  convert "${row_images[@]}" +append -background '#171a16' -gravity west -extent 1536x227 "$row_path"
  rows+=("$row_path")
done

convert "${rows[@]}" -append "rendered/$stem-contact-sheet.png"
