#!/usr/bin/env python3
import re
import subprocess
import sys
import zipfile
from pathlib import Path


EXPECTED_SLIDES = 17
OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")


def fail(message: str) -> None:
    raise SystemExit(f"verification failed: {message}")


def verify_pptx(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            fail(f"{path} has a corrupt ZIP member")
        names = archive.namelist()
        slides = [name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]
        notes = [name for name in names if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", name)]
    if len(slides) != EXPECTED_SLIDES:
        fail(f"{path} has {len(slides)} slides, expected {EXPECTED_SLIDES}")
    if len(notes) != EXPECTED_SLIDES:
        fail(f"{path} has {len(notes)} notes pages, expected {EXPECTED_SLIDES}")


def verify_odp(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            fail(f"{path} has a corrupt ZIP member")
        content = archive.read("content.xml")
        mime = archive.read("mimetype")
    if mime != b"application/vnd.oasis.opendocument.presentation":
        fail(f"{path} has an unexpected MIME type")
    pages = content.count(b"<draw:page ")
    if pages != EXPECTED_SLIDES:
        fail(f"{path} has {pages} slides, expected {EXPECTED_SLIDES}")


def verify_pdf(path: Path) -> None:
    if path.read_bytes()[:5] != b"%PDF-":
        fail(f"{path} is not a PDF")
    output = subprocess.check_output(["pdfinfo", str(path)], text=True)
    match = re.search(r"^Pages:\s+(\d+)$", output, re.MULTILINE)
    if not match or int(match.group(1)) != EXPECTED_SLIDES:
        fail(f"{path} does not contain {EXPECTED_SLIDES} pages")


def verify_ppt(path: Path) -> None:
    if path.read_bytes()[:8] != OLE_MAGIC:
        fail(f"{path} is not a legacy PowerPoint OLE document")


def main(paths: list[str]) -> None:
    if len(paths) != 4:
        fail("expected PPTX, ODP, PDF, and PPT paths")
    for raw in paths:
        path = Path(raw)
        if not path.is_file():
            fail(f"missing {path}")
        if path.stat().st_size < 100_000:
            fail(f"{path} is unexpectedly small")
        {
            ".pptx": verify_pptx,
            ".odp": verify_odp,
            ".pdf": verify_pdf,
            ".ppt": verify_ppt,
        }[path.suffix](path)
        print(f"OK {path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main(sys.argv[1:])
