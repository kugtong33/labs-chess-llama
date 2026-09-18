#!/usr/bin/env bash
set -euo pipefail

stem=${1:?output stem is required}
input="deliverables/$stem.pptx"
export_dir="deliverables/export"
profile_dir="/tmp/libreoffice-profile-$stem"

mkdir -p "$export_dir" "$profile_dir"

soffice \
  "-env:UserInstallation=file://$profile_dir" \
  --headless \
  --convert-to odp:"impress8" \
  --outdir "$export_dir" \
  "$input"

soffice \
  "-env:UserInstallation=file://$profile_dir" \
  --headless \
  --convert-to pdf:"impress_pdf_Export" \
  --outdir "$export_dir" \
  "$input"

soffice \
  "-env:UserInstallation=file://$profile_dir" \
  --headless \
  --convert-to ppt:"MS PowerPoint 97" \
  --outdir "$export_dir" \
  "$input"

mv -f "$export_dir/$stem.odp" "deliverables/$stem.odp"
mv -f "$export_dir/$stem.pdf" "deliverables/$stem.pdf"
mv -f "$export_dir/$stem.ppt" "deliverables/$stem.ppt"
