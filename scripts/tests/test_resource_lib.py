from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from resource_lib import (  # noqa: E402
    DEFAULT_CATALOG,
    ResourceError,
    atomic_write_json,
    audit_catalog,
    extract_links,
    load_catalog,
    manifest_payload,
    validate_file,
    validate_source_url,
)
from teacher_readings import (  # noqa: E402
    TranslatorSettings,
    render_teacher_html,
    translate_teacher_markdown,
    validate_teacher_markdown,
)


class FakeResponse:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size: int) -> bytes:
        return self.payload


class ResourceLibraryTests(unittest.TestCase):
    def test_current_catalog_is_clean(self) -> None:
        issues = audit_catalog(load_catalog(DEFAULT_CATALOG))
        self.assertEqual([], issues)

    def test_manifest_is_deterministic(self) -> None:
        catalog = load_catalog(DEFAULT_CATALOG)
        first = manifest_payload(catalog)
        second = manifest_payload(json.loads(json.dumps(catalog)))
        self.assertEqual(first, second)
        self.assertEqual(101, first["resourceCount"])
        self.assertEqual(52, first["localResourceCount"])

    def test_html_error_page_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "error.html"
            path.write_text("<!doctype html><html><body>404 not found" + "x" * 200 + "</body></html>")
            with self.assertRaises(ResourceError):
                validate_file(path, "article")

    def test_html_with_active_content_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "unsafe.html"
            path.write_text(
                "<!doctype html><html><body><p>" + "x" * 200 + "</p><script>alert(1)</script></body></html>"
            )
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

    def test_extract_links_resolves_relative_urls_without_duplicates(self) -> None:
        html = '<a href="2026t311.pptx">PPT</a><a href="2026t311.pptx">PPT</a>'
        self.assertEqual(
            ["https://www.fustero.es/2026t311.pptx"],
            extract_links("https://www.fustero.es/", html),
        )

    def test_atomic_json_write_produces_valid_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            atomic_write_json(path, {"ok": True, "texto": "válido"})
            self.assertEqual({"ok": True, "texto": "válido"}, json.loads(path.read_text(encoding="utf-8")))

    def test_teacher_markdown_requires_the_three_sections(self) -> None:
        markdown = (
            "---\ntitle: Teacher Comments\ndate: 01/01/2027\n---\n\n"
            "#### Part I: Overview\n\n" + "Overview paragraph. " * 25 + "\n\n"
            "#### Part II: Commentary\n\n" + "Commentary paragraph. " * 25 + "\n\n"
            "#### Part III: Life Application\n\n" + "Application paragraph. " * 25
        )
        validate_teacher_markdown(markdown, language="en")
        with self.assertRaises(ResourceError):
            validate_teacher_markdown(markdown.replace("Part II: Commentary", "Commentary"), language="en")

    def test_teacher_html_renderer_escapes_raw_markup(self) -> None:
        markdown = (
            "---\ntitle: Comentarios para maestros\ndate: 01/01/2027\n---\n\n"
            "#### Parte I: Visión General\n\n" + "Texto seguro <img src=x onerror=alert(1)>. " * 25 + "\n\n"
            "#### Parte II: Comentario\n\n" + "Comentario **importante**. " * 25 + "\n\n"
            "#### Parte III: Aplicación a la Vida\n\n" + "Aplicación práctica. " * 25
        )
        validate_teacher_markdown(markdown, language="es")
        rendered = render_teacher_html(
            markdown,
            lesson_number=1,
            source_url="https://raw.githubusercontent.com/example/source.md",
            provider_url="https://github.com/Adventech/sabbath-school-lessons",
        )
        self.assertNotIn("<img", rendered)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", rendered)
        self.assertIn("<strong>importante</strong>", rendered)
        self.assertIn("Fuente original", rendered)

    def test_teacher_translation_supports_responses_api(self) -> None:
        source = (
            "---\ntitle: Teacher Comments\ndate: 01/01/2027\n---\n\n"
            "#### Part I: Overview\n\n" + "Overview paragraph. " * 25 + "\n\n"
            "#### Part II: Commentary\n\n" + "Commentary paragraph. " * 25 + "\n\n"
            "#### Part III: Life Application\n\n" + "Application paragraph. " * 25
        )
        translated = (
            "---\ntitle: Comentarios para maestros\ndate: 01/01/2027\n---\n\n"
            "#### Parte I: Visión General\n\n" + "Párrafo de visión general. " * 25 + "\n\n"
            "#### Parte II: Comentario\n\n" + "Párrafo de comentario. " * 25 + "\n\n"
            "#### Parte III: Aplicación a la Vida\n\n" + "Párrafo de aplicación. " * 25
        )
        response = json.dumps(
            {
                "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": translated}]}
                ]
            }
        ).encode("utf-8")
        settings = TranslatorSettings("https://api.openai.com/v1/responses", "secret", "configured-model")
        with patch("teacher_readings.urllib.request.urlopen", return_value=FakeResponse(response)) as mocked:
            result = translate_teacher_markdown(source, settings, timeout=1)
        self.assertEqual(translated.strip(), result)
        request_payload = json.loads(mocked.call_args.args[0].data)
        self.assertEqual(source, request_payload["input"])
        self.assertFalse(request_payload["store"])


if __name__ == "__main__":
    unittest.main()
