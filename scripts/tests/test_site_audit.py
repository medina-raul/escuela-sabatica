from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from audit_site_build import audit_dist  # noqa: E402


class SiteBuildAuditTests(unittest.TestCase):
    def test_valid_local_page_and_asset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            (dist / "index.html").write_text(
                '<a href="/lecciones/uno">Uno</a><img src="/cover.svg">',
                encoding="utf-8",
            )
            page = dist / "lecciones/uno/index.html"
            page.parent.mkdir(parents=True)
            page.write_text('<a href="/">Inicio</a>', encoding="utf-8")
            (dist / "cover.svg").write_text("<svg></svg>", encoding="utf-8")
            report = audit_dist(dist)
            self.assertEqual(2, report["pagesScanned"])
            self.assertEqual([], report["issues"])

    def test_broken_reference_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            (dist / "index.html").write_text('<script src="/_astro/missing.js"></script>', encoding="utf-8")
            report = audit_dist(dist)
            self.assertEqual("broken-local-reference", report["issues"][0]["code"])
            self.assertEqual("/_astro/missing.js", report["issues"][0]["reference"])


if __name__ == "__main__":
    unittest.main()
