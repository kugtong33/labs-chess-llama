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

for row in 0 1 2 3; do
  first=$((row * 4 + 1))
  second=$((first + 1))
  third=$((first + 2))
  fourth=$((first + 3))
  printf -v first_name 'slide-%02d.png' "$first"
  printf -v second_name 'slide-%02d.png' "$second"
  printf -v third_name 'slide-%02d.png' "$third"
  printf -v fourth_name 'slide-%02d.png' "$fourth"
  convert \
    "$thumb_dir/$first_name" \
    "$thumb_dir/$second_name" \
    "$thumb_dir/$third_name" \
    "$thumb_dir/$fourth_name" \
    +append \
    "$thumb_dir/row-$row.png"
done

convert \
  "$thumb_dir/row-0.png" \
  "$thumb_dir/row-1.png" \
  "$thumb_dir/row-2.png" \
  "$thumb_dir/row-3.png" \
  -append \
  "rendered/$stem-contact-sheet.png"
