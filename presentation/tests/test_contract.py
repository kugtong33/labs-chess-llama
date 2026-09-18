import json
import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PresentationContractTest(unittest.TestCase):
    def test_content_has_seventeen_slides_and_required_story_beats(self) -> None:
        content = json.loads((ROOT / "src" / "content.json").read_text())

        self.assertEqual(content["title"], "Local LLMs: My 8GB VRAM vs the World")
        self.assertEqual(len(content["slides"]), 17)
        self.assertEqual([slide["number"] for slide in content["slides"]], list(range(1, 18)))

        rendered = json.dumps(content, ensure_ascii=False)
        for required in (
            "ENIAC",
            "mainframe",
            "Kenbak-1",
            "quantization",
            "Hugging Face",
            "llama.cpp",
            "Ollama",
            "Qwen3-4B",
            "RTX 4060",
            "Stockfish",
            "open-weight",
            "https://github.com/kugtong33/labs-chess-llama",
            "https://github.com/kugtong33/labs-local-llm",
        ):
            with self.subTest(required=required):
                self.assertIn(required, rendered)

        self.assertEqual(content["slides"][-1]["kind"], "repositories")

        for slide in content["slides"]:
            self.assertTrue(slide["title"].strip())
            self.assertTrue(slide["notes"].strip())

    def test_attribution_manifest_covers_all_external_assets(self) -> None:
        manifest = json.loads((ROOT / "assets" / "manifest.json").read_text())
        expected = {
            "eniac.png",
            "ibm-2030.jpg",
            "kenbak1.jpg",
            "hugging-face.svg",
            "llama-cpp.svg",
            "ollama.svg",
        }

        self.assertEqual({entry["file"] for entry in manifest}, expected)
        for entry in manifest:
            with self.subTest(file=entry["file"]):
                self.assertRegex(entry["source"], r"^https://")
                self.assertTrue(entry["author"].strip())
                self.assertTrue(entry["license"].strip())
                self.assertRegex(entry["sha256"], r"^[a-f0-9]{64}$")
                asset = ROOT / "assets" / "source" / entry["file"]
                self.assertTrue(asset.is_file())
                self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(), entry["sha256"])

    def test_build_interface_declares_all_deliverables(self) -> None:
        script = (ROOT / "build.sh").read_text()
        for extension in ("pdf", "odp", "pptx", "ppt"):
            with self.subTest(extension=extension):
                self.assertIn(f"local-llms-my-8gb-vram-vs-world.{extension}", script)
        self.assertIsNotNone(re.search(r"\ball\b", script))
        self.assertIsNotNone(re.search(r"\bverify\b", script))

    def test_images_use_aspect_preserving_sizing(self) -> None:
        generator = (ROOT / "src" / "deck.mjs").read_text()
        self.assertIn("sizing: { type: sizing, w, h }", generator)
        self.assertIn("const aspect = ASSET_ASPECTS[asset]", generator)
        self.assertIn("w: 1, h: aspect", generator)
        self.assertIn("function containImagePlacement", generator)
        self.assertIn('if (sizing === "contain")', generator)
        self.assertNotIn("x, y, w, h, sizing });", generator)


if __name__ == "__main__":
    unittest.main()
