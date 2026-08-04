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

import resource_lib  # noqa: E402
import import_manual_resources  # noqa: E402
import restructure_resources  # noqa: E402
from import_manual_resources import apply_plan as apply_manual_plan  # noqa: E402
from import_manual_resources import build_plan as build_manual_plan  # noqa: E402
from resource_lib import sha256_path  # noqa: E402
from restructure_resources import apply_plan as apply_layout_plan  # noqa: E402
from restructure_resources import build_plan as build_layout_plan  # noqa: E402


def layout_config() -> dict:
    return {
        "roleTemplates": {
            "weekly-presentation": "/recursos/{quarterId}/ppt/leccion-{lesson:02d}.pptx",
            "daily-audio": "/recursos/{quarterId}/audio/leccion-{lesson:02d}/{day}.mp3",
            "friday-reading": "/recursos/{quarterId}/lecturas/viernes/leccion-{lesson:02d}.html",
            "general-reading": "/recursos/{quarterId}/lecturas/generales/{filename}",
        },
        "legacySearchRoots": ["public", "legacy-resources"],
    }


def base_catalog() -> dict:
    return {
        "id": "test-q",
        "lessons": [{"number": 1, "resources": []}],
        "resources": [],
        "resourceAutomation": {
            "allowedSourceHosts": [],
            "maxDownloadBytes": 50_000_000,
            "canonicalLayout": layout_config(),
            "manualInbox": {
                "path": "resource-inbox",
                "descriptorSuffix": ".resource.json",
                "requireDescriptorForNew": True,
            },
        },
    }


def write_html(path: Path, marker: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"<!doctype html><html><body><p>{marker * 180}</p></body></html>", encoding="utf-8")


class PortableResourceTests(unittest.TestCase):
    def test_restructure_moves_a_legacy_file_and_updates_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            legacy = public / "old/presentation.pptx"
            legacy.parent.mkdir(parents=True)
            with zipfile.ZipFile(legacy, "w") as archive:
                archive.writestr("[Content_Types].xml", "x" * 6000)
                archive.writestr("ppt/presentation.xml", "x" * 6000)
            catalog = base_catalog()
            catalog["resources"].append(
                {
                    "id": "ppt-01",
                    "type": "ppt",
                    "role": "weekly-presentation",
                    "lessonNumber": 1,
                    "title": "Presentación 1",
                    "url": "/old/presentation.pptx",
                    "storage": "local",
                    "source": {"kind": "manual"},
                    "checksum": sha256_path(legacy),
                    "sizeBytes": legacy.stat().st_size,
                }
            )
            catalog_path = root / "catalog.json"
            manifest_path = public / "resource-manifest.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with patch.object(resource_lib, "PROJECT_ROOT", root), patch.object(
                resource_lib, "PUBLIC_ROOT", public
            ), patch.object(restructure_resources, "PROJECT_ROOT", root):
                operations, errors = build_layout_plan(catalog)
                self.assertEqual([], errors)
                self.assertEqual(1, len(operations))
                apply_layout_plan(catalog, catalog_path, manifest_path, operations)
            target = public / "recursos/test-q/ppt/leccion-01.pptx"
            self.assertTrue(target.is_file())
            self.assertFalse(legacy.exists())
            updated = json.loads(catalog_path.read_text(encoding="utf-8"))["resources"][0]
            self.assertEqual("/recursos/test-q/ppt/leccion-01.pptx", updated["url"])

    def test_restructure_recovers_a_missing_canonical_file_from_legacy_roots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            legacy = root / "legacy-resources/leccion-01.pptx"
            legacy.parent.mkdir(parents=True)
            with zipfile.ZipFile(legacy, "w") as archive:
                archive.writestr("[Content_Types].xml", "x" * 6000)
                archive.writestr("ppt/presentation.xml", "x" * 6000)
            catalog = base_catalog()
            catalog["resources"].append(
                {
                    "id": "ppt-01",
                    "type": "ppt",
                    "role": "weekly-presentation",
                    "lessonNumber": 1,
                    "title": "Presentación 1",
                    "url": "/recursos/test-q/ppt/leccion-01.pptx",
                    "storage": "local",
                    "source": {"kind": "manual"},
                    "checksum": sha256_path(legacy),
                    "sizeBytes": legacy.stat().st_size,
                }
            )
            catalog_path = root / "catalog.json"
            manifest_path = public / "resource-manifest.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with patch.object(resource_lib, "PROJECT_ROOT", root), patch.object(
                resource_lib, "PUBLIC_ROOT", public
            ), patch.object(restructure_resources, "PROJECT_ROOT", root):
                operations, errors = build_layout_plan(catalog)
                self.assertEqual([], errors)
                self.assertEqual(legacy.resolve(), operations[0]["from"])
                apply_layout_plan(catalog, catalog_path, manifest_path, operations)
            self.assertTrue((public / "recursos/test-q/ppt/leccion-01.pptx").is_file())
            self.assertFalse(legacy.exists())

    def test_manual_inbox_updates_an_existing_manual_resource(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            target = public / "recursos/test-q/lecturas/viernes/leccion-01.html"
            payload = root / "resource-inbox/test-q/lecturas/viernes/leccion-01.html"
            write_html(target, "anterior")
            write_html(payload, "nuevo")
            catalog = base_catalog()
            catalog["resources"].append(
                {
                    "id": "reading-friday-01",
                    "type": "article",
                    "role": "friday-reading",
                    "lessonNumber": 1,
                    "title": "Viernes 1",
                    "url": "/recursos/test-q/lecturas/viernes/leccion-01.html",
                    "storage": "local",
                    "source": {"kind": "manual"},
                    "checksum": sha256_path(target),
                    "sizeBytes": target.stat().st_size,
                }
            )
            catalog_path = root / "catalog.json"
            manifest_path = public / "resource-manifest.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with patch.object(resource_lib, "PROJECT_ROOT", root), patch.object(
                resource_lib, "PUBLIC_ROOT", public
            ), patch.object(import_manual_resources, "PROJECT_ROOT", root):
                operations, errors, _inbox = build_manual_plan(catalog)
                self.assertEqual([], errors)
                apply_manual_plan(catalog, catalog_path, manifest_path, operations)
            self.assertIn("nuevo", target.read_text(encoding="utf-8"))
            updated = json.loads(catalog_path.read_text(encoding="utf-8"))["resources"][0]
            self.assertEqual("resource-inbox/test-q/lecturas/viernes/leccion-01.html", updated["source"]["inboxPath"])

    def test_manual_inbox_adds_a_new_described_resource(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            payload = root / "resource-inbox/test-q/lecturas/generales/estudio-especial.html"
            write_html(payload, "estudio")
            descriptor = {
                "id": "reading-general-estudio-especial",
                "type": "article",
                "role": "general-reading",
                "title": "Estudio especial",
                "description": "Lectura complementaria",
            }
            Path(str(payload) + ".resource.json").write_text(json.dumps(descriptor), encoding="utf-8")
            catalog = base_catalog()
            catalog_path = root / "catalog.json"
            manifest_path = public / "resource-manifest.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with patch.object(resource_lib, "PROJECT_ROOT", root), patch.object(
                resource_lib, "PUBLIC_ROOT", public
            ), patch.object(import_manual_resources, "PROJECT_ROOT", root):
                operations, errors, _inbox = build_manual_plan(catalog)
                self.assertEqual([], errors)
                apply_manual_plan(catalog, catalog_path, manifest_path, operations)
            updated = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.assertEqual("reading-general-estudio-especial", updated["resources"][0]["id"])
            self.assertTrue((public / "recursos/test-q/lecturas/generales/estudio-especial.html").is_file())

    def test_manual_inbox_registers_a_new_local_audio_in_the_daily_lesson(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = root / "public"
            payload = root / "resource-inbox/test-q/audio/leccion-01/sabado.mp3"
            payload.parent.mkdir(parents=True)
            payload.write_bytes(b"ID3" + b"x" * 12_000)
            descriptor = {
                "id": "audio-local-01-sabado",
                "type": "audio",
                "role": "daily-audio",
                "lessonNumber": 1,
                "dayId": "sabado",
                "title": "Lección 1 — Sábado",
                "provider": "Producción local",
            }
            Path(str(payload) + ".resource.json").write_text(json.dumps(descriptor), encoding="utf-8")
            catalog = base_catalog()
            catalog["lessons"][0]["days"] = [{"id": "sabado"}]
            catalog_path = root / "catalog.json"
            manifest_path = public / "resource-manifest.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with patch.object(resource_lib, "PROJECT_ROOT", root), patch.object(
                resource_lib, "PUBLIC_ROOT", public
            ), patch.object(import_manual_resources, "PROJECT_ROOT", root):
                operations, errors, _inbox = build_manual_plan(catalog)
                self.assertEqual([], errors)
                apply_manual_plan(catalog, catalog_path, manifest_path, operations)
            updated = json.loads(catalog_path.read_text(encoding="utf-8"))
            audio_url = "/recursos/test-q/audio/leccion-01/sabado.mp3"
            self.assertEqual(audio_url, updated["lessons"][0]["days"][0]["audio"]["url"])
            self.assertTrue((public / audio_url.lstrip("/")).is_file())


if __name__ == "__main__":
    unittest.main()
