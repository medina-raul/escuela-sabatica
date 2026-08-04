from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from resource_lib import (  # noqa: E402
    DEFAULT_CATALOG,
    ResourceError,
    atomic_write_json,
    audit_catalog,
    load_catalog,
    manifest_payload,
    validate_file,
    validate_source_url,
)


class ResourceLibraryTests(unittest.TestCase):
    def test_current_catalog_is_clean(self) -> None:
        issues = audit_catalog(load_catalog(DEFAULT_CATALOG))
        self.assertEqual([], issues)

    def test_manifest_is_deterministic(self) -> None:
        catalog = load_catalog(DEFAULT_CATALOG)
        first = manifest_payload(catalog)
        second = manifest_payload(json.loads(json.dumps(catalog)))
        self.assertEqual(first, second)
        self.assertEqual(100, first["resourceCount"])
        self.assertEqual(51, first["localResourceCount"])

    def test_html_error_page_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "error.html"
            path.write_text("<!doctype html><html><body>404 not found" + "x" * 200 + "</body></html>")
            with self.assertRaises(ResourceError):
                validate_file(path, "article")

    def test_valid_pptx_container_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.pptx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("[Content_Types].xml", "x" * 6000)
                archive.writestr("ppt/presentation.xml", "x" * 6000)
            validate_file(path, "ppt")

    def test_source_allowlist_is_enforced(self) -> None:
        validate_source_url("https://www.audioescuelasabatica.com/audio.mp3", {"www.audioescuelasabatica.com"})
        with self.assertRaises(ResourceError):
            validate_source_url("https://example.com/audio.mp3", {"www.audioescuelasabatica.com"})

    def test_atomic_json_write_produces_valid_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            atomic_write_json(path, {"ok": True, "texto": "válido"})
            self.assertEqual({"ok": True, "texto": "válido"}, json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
