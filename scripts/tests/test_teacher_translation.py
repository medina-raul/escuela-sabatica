from __future__ import annotations

import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

import resource_lib  # noqa: E402
from resource_lib import RemoteMetadata, sha256_bytes, sha256_path  # noqa: E402
from teacher_translation import apply_translation, fetch_source  # noqa: E402


def english_markdown() -> str:
    return (
        "---\ntitle: Teacher Comments\ndate: 01/01/2027\n---\n\n"
        "#### Part I: Overview\n\n" + "Overview paragraph. " * 25 + "\n\n"
        "#### Part II: Commentary\n\n" + "Commentary paragraph. " * 25 + "\n\n"
        "#### Part III: Life Application\n\n" + "Application paragraph. " * 25
    )


def spanish_markdown() -> str:
    return (
        "---\ntitle: Comentarios para maestros\ndate: 01/01/2027\n---\n\n"
        "#### Parte I: Visión General\n\n" + "Párrafo de visión general. " * 25 + "\n\n"
        "#### Parte II: Comentario\n\n" + "Párrafo de comentario. " * 25 + "\n\n"
        "#### Parte III: Aplicación a la Vida\n\n" + "Párrafo de aplicación. " * 25
    )


def catalog_payload(source_checksum: str, html_checksum: str, html_size: int) -> dict:
    source_url = "https://raw.githubusercontent.com/Adventech/example/teacher-comments.md"
    return {
        "id": "test-q",
        "lessons": [{"number": 1, "resources": []}],
        "resources": [
            {
                "id": "reading-teacher-01",
                "type": "article",
                "role": "teacher-reading",
                "lessonNumber": 1,
                "title": "Material para Maestros — Lección 1",
                "url": "/recursos/test-q/lecturas/maestros/leccion-01.html",
                "storage": "local",
                "source": {
                    "kind": "url",
                    "url": source_url,
                    "allowedContentTypes": ["text/plain"],
                    "maxBytes": 500000,
                    "provider": "Adventech",
                    "providerUrl": "https://github.com/Adventech/sabbath-school-lessons",
                    "credit": "Fuente atribuida",
                    "currentChecksum": source_checksum,
                },
                "translation": {
                    "sourceLanguage": "en",
                    "targetLanguage": "es",
                    "method": "manual",
                    "sourceChecksum": source_checksum,
                    "reviewStatus": "reviewed-existing",
                },
                "checksum": html_checksum,
                "sizeBytes": html_size,
            }
        ],
        "resourceAutomation": {
            "allowedSourceHosts": ["raw.githubusercontent.com"],
            "maxDownloadBytes": 50000000,
            "teacherReadingDiscovery": {
                "sourceUrlTemplate": source_url,
                "sourceQuarter": "2027-01",
                "lessonStart": 1,
                "lessonEnd": 1,
                "localUrlTemplate": "/recursos/{quarterId}/lecturas/maestros/leccion-{lesson:02d}.html",
                "allowedContentTypes": ["text/plain"],
                "maxBytes": 500000,
                "maxOutputBytes": 1000000,
                "provider": "Adventech",
                "providerUrl": "https://github.com/Adventech/sabbath-school-lessons",
                "credit": "Fuente atribuida",
                "reviewRequired": True,
            },
        },
    }


class TeacherTranslationTests(unittest.TestCase):
    def test_fetch_revalidates_source_before_writing_handoff(self) -> None:
        source = english_markdown()
        checksum = sha256_bytes(source.encode("utf-8"))
        metadata = RemoteMetadata("https://raw.githubusercontent.com/source.md", "text/plain", len(source), None, None)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog_path = root / "catalog.json"
            catalog_path.write_text(
                json.dumps(catalog_payload(checksum, "sha256:" + "0" * 64, 200)),
                encoding="utf-8",
            )
            output = root / "artifacts/source.md"
            args = argparse.Namespace(
                catalog=catalog_path,
                lesson=1,
                output=output,
                expected_checksum=checksum,
                timeout=1,
            )
            with patch("teacher_translation.PROJECT_ROOT", root), patch(
                "teacher_translation.fetch_text",
                return_value=(source, checksum, len(source), metadata),
            ):
                result = fetch_source(args)
            self.assertEqual("validated", result["status"])
            self.assertEqual(source, output.read_text(encoding="utf-8"))

    def test_apply_generates_html_and_agent_provenance_atomically(self) -> None:
        source = english_markdown()
        translated = spanish_markdown()
        source_checksum = sha256_bytes(source.encode("utf-8"))
        old_html = "<!doctype html><html><body><p>" + "contenido anterior " * 20 + "</p></body></html>"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public_root = root / "public"
            target = public_root / "recursos/test-q/lecturas/maestros/leccion-01.html"
            target.parent.mkdir(parents=True)
            target.write_text(old_html, encoding="utf-8")
            catalog_path = root / "catalog.json"
            manifest_path = public_root / "resource-manifest.json"
            catalog_path.write_text(
                json.dumps(catalog_payload(source_checksum, sha256_path(target), target.stat().st_size)),
                encoding="utf-8",
            )
            source_path = root / "artifacts/source.md"
            input_path = root / "artifacts/translated.md"
            source_path.parent.mkdir(parents=True)
            source_path.write_text(source, encoding="utf-8")
            input_path.write_text(translated, encoding="utf-8")
            args = argparse.Namespace(
                catalog=catalog_path,
                manifest=manifest_path,
                lesson=1,
                source=source_path,
                input=input_path,
                source_checksum=source_checksum,
                model="test-model",
                producer="test-agent",
            )
            with patch("teacher_translation.PROJECT_ROOT", root), patch.object(
                resource_lib, "PROJECT_ROOT", root
            ), patch.object(resource_lib, "PUBLIC_ROOT", public_root):
                result = apply_translation(args)

            updated = json.loads(catalog_path.read_text(encoding="utf-8"))["resources"][0]
            self.assertEqual("applied-pending-review", result["status"])
            self.assertEqual("assisted-translation", updated["translation"]["method"])
            self.assertEqual("test-model", updated["translation"]["model"])
            self.assertEqual("test-agent", updated["translation"]["producer"])
            self.assertEqual("pending-review", updated["translation"]["reviewStatus"])
            self.assertEqual(source_checksum, updated["translation"]["sourceChecksum"])
            self.assertIn("Parte I: Visión General", target.read_text(encoding="utf-8"))
            self.assertTrue(manifest_path.is_file())


if __name__ == "__main__":
    unittest.main()
