import re
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "deliverables"
STEM = "local-llms-my-8gb-vram-vs-world"


class PresentationOutputTests(unittest.TestCase):
    def test_pptx_is_a_complete_editable_deck(self):
        path = DIST / f"{STEM}.pptx"
        self.assertGreater(path.stat().st_size, 100_000)
        with zipfile.ZipFile(path) as archive:
            self.assertIsNone(archive.testzip())
            slides = [
                name
                for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ]
            notes = [
                name
                for name in archive.namelist()
                if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", name)
            ]
        self.assertEqual(len(slides), 17)
        self.assertEqual(len(notes), 17)

    def test_odp_is_a_complete_editable_deck(self):
        path = DIST / f"{STEM}.odp"
        self.assertGreater(path.stat().st_size, 100_000)
        with zipfile.ZipFile(path) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read("mimetype"), b"application/vnd.oasis.opendocument.presentation")
            content = archive.read("content.xml")
        self.assertEqual(content.count(b"<draw:page "), 17)
        self.assertEqual(content.count(b"<presentation:notes"), 17)

    def test_pdf_and_legacy_ppt_are_present(self):
        pdf = DIST / f"{STEM}.pdf"
        ppt = DIST / f"{STEM}.ppt"
        self.assertGreater(pdf.stat().st_size, 100_000)
        self.assertEqual(pdf.read_bytes()[:5], b"%PDF-")
        self.assertGreater(ppt.stat().st_size, 100_000)
        self.assertEqual(ppt.read_bytes()[:8], bytes.fromhex("D0CF11E0A1B11AE1"))

    def test_embedded_assets_preserve_their_aspect_ratios(self):
        path = DIST / f"{STEM}.pptx"
        with zipfile.ZipFile(path) as archive:
            for slide_number in (4, 5, 6):
                xml = archive.read(f"ppt/slides/slide{slide_number}.xml")
                crop = re.search(rb"<a:srcRect ([^>]*)/>", xml)
                self.assertIsNotNone(crop)
                self.assertRegex(crop.group(1), rb'[lrtb]="[1-9]\d*"')

            root = ET.fromstring(archive.read("ppt/slides/slide10.xml"))

        ns = {
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        }
        ratios = []
        for picture in root.findall(".//p:pic", ns):
            extent = picture.find("./p:spPr/a:xfrm/a:ext", ns)
            ratios.append(int(extent.attrib["cx"]) / int(extent.attrib["cy"]))

        expected = [963 / 256, 2793 / 600, 17 / 25]
        self.assertEqual(len(ratios), len(expected))
        for actual, target in zip(ratios, expected):
            self.assertAlmostEqual(actual, target, places=3)


if __name__ == "__main__":
    unittest.main()
