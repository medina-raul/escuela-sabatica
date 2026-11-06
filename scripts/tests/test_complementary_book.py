from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from complementary_book import BOOK_ROLE, discover_book, parse_index
from resource_lib import RemoteMetadata, ResourceError


INDEX = """
<h3>Contenido</h3>
<ul>
  <li>Capítulo 2. Segunda lectura</li>
  <li>Introducción | <a href="https://drive.google.com/file/d/intro-id/view"><img alt="PDF"></a></li>
  <li>Capítulo 1. <em>Primera lectura</em> (03 de octubre) |
      <a href="https://drive.google.com/file/d/chapter-id/view?usp=drive_link"><img alt="PDF"></a></li>
</ul>
"""


class ComplementaryBookTests(unittest.TestCase):
    def test_index_keeps_introduction_distinct_and_unlinked_chapters_pending(self):
        self.assertEqual(
            {0: ("Introducción", "intro-id"), 1: ("Primera lectura", "chapter-id"), 2: ("Segunda lectura", None)},
            parse_index(INDEX, {1, 2}),
        )

    def test_index_rejects_wrong_slots_and_ambiguous_pdfs(self):
        for html in (
            INDEX.replace("Capítulo 2.", "Capítulo 1."),
            INDEX.replace("Capítulo 2.", "Capítulo 3."),
            INDEX.replace("chapter-id", "intro-id"),
            INDEX.replace("drive.google.com/file/d/chapter-id", "example.org/file/d/chapter-id"),
        ):
            with self.subTest(html=html), self.assertRaises(ResourceError):
                parse_index(html, {1, 2})

    @patch("complementary_book.fetch_text", return_value=(INDEX, "", 0, None))
    @patch("complementary_book.download_to")
    def test_discovery_checks_filename_and_pdf_signature_then_retries_only_pending(self, download, _fetch):
        catalog = {
            "year": 2026, "quarterNumber": 4,
            "lessons": [{"number": 1}, {"number": 2}],
            "resourceAutomation": {"complementaryBookDiscovery": {
                "indexUrl": "https://example.org/book", "title": "Libro de prueba", "credit": "Editorial",
            }},
        }
        correct_chapter = False

        def fake_download(url, destination, **_kwargs):
            is_intro = url.endswith("intro-id")
            number = 0 if is_intro else 1 if correct_chapter else 2
            pdf = b"%PDF-1.7\n%%EOF\n"
            destination.write_bytes(pdf)
            filename = f"Libro Complementario 2026-4T_L{number:02d}.pdf"
            return "sha256:sample", len(pdf), RemoteMetadata(url, "application/pdf", len(pdf), None, None, filename)

        download.side_effect = fake_download
        changes, warnings = [], []
        with tempfile.TemporaryDirectory() as directory:
            def discover():
                discover_book(catalog, Path(directory), allowed_hosts={"example.org"}, timeout=1, changes=changes, warnings=warnings)

            discover()
            self.assertEqual([BOOK_ROLE], [item["role"] for item in catalog["resources"]])
            self.assertNotIn("lessonNumber", catalog["resources"][0])
            self.assertIn("Se esperaba", warnings[0])
            correct_chapter = True
            discover()
            self.assertEqual(1, catalog["resources"][1]["lessonNumber"])
            self.assertEqual(3, download.call_count)
            discover()
            self.assertEqual(3, download.call_count)
            self.assertEqual(2, len(changes))
