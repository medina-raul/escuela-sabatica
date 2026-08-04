from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from resource_lib import RemoteMetadata  # noqa: E402
from update_resources import _discover_teacher_readings  # noqa: E402


def source_markdown() -> str:
    return (
        "---\ntitle: Teacher Comments\ndate: 01/01/2027\n---\n\n"
        "#### Part I: Overview\n\n" + "Overview paragraph. " * 25 + "\n\n"
        "#### Part II: Commentary\n\n" + "Commentary paragraph. " * 25 + "\n\n"
        "#### Part III: Life Application\n\n" + "Application paragraph. " * 25
    )


class TeacherUpdateTests(unittest.TestCase):
    def test_changed_source_without_translator_preserves_published_html(self) -> None:
        old_checksum = "sha256:" + "1" * 64
        new_checksum = "sha256:" + "2" * 64
        source_url = "https://raw.githubusercontent.com/example/teacher-comments.md"
        catalog = {
            "id": "2026-q3",
            "resourceAutomation": {
                "teacherReadingDiscovery": {
                    "sourceUrlTemplate": source_url,
                    "sourceQuarter": "2026-03",
                    "lessonStart": 1,
                    "lessonEnd": 1,
                    "localUrlTemplate": "/recursos/{quarterId}/lecturas/maestros/leccion-{lesson:02d}.html",
                    "allowedContentTypes": ["text/plain"],
                    "maxBytes": 500000,
                    "maxOutputBytes": 1000000,
                    "provider": "Adventech",
                    "providerUrl": "https://github.com/Adventech/sabbath-school-lessons",
                    "credit": "Fuente original atribuida",
                }
            },
            "resources": [
                {
                    "id": "reading-teacher-01",
                    "type": "article",
                    "role": "teacher-reading",
                    "lessonNumber": 1,
                    "title": "Material para Maestros — Lección 1",
                    "url": "/recursos/2026-q3/lecturas/maestros/leccion-01.html",
                    "storage": "local",
                    "source": {"kind": "url", "url": source_url, "currentChecksum": old_checksum},
                    "translation": {
                        "sourceLanguage": "en",
                        "targetLanguage": "es",
                        "method": "manual",
                        "sourceChecksum": old_checksum,
                        "reviewStatus": "reviewed-existing",
                    },
                }
            ],
            "lessons": [],
        }
        metadata = RemoteMetadata(source_url, "text/plain", 5000, '"etag"', None)
        changes: list[str] = []
        warnings: list[str] = []
        tasks: list[dict] = []
        with patch(
            "update_resources.fetch_text",
            return_value=(source_markdown(), new_checksum, 5000, metadata),
        ):
            handled = _discover_teacher_readings(
                catalog,
                allowed_hosts={"raw.githubusercontent.com"},
                timeout=1,
                changes=changes,
                warnings=warnings,
                tasks=tasks,
            )

        resource = catalog["resources"][0]
        self.assertEqual({"reading-teacher-01"}, handled)
        self.assertEqual(old_checksum, resource["translation"]["sourceChecksum"])
        self.assertEqual(new_checksum, resource["source"]["currentChecksum"])
        self.assertEqual("source-changed", resource["translation"]["reviewStatus"])
        self.assertEqual(new_checksum, resource["translation"]["detectedSourceChecksum"])
        self.assertTrue(warnings)
        self.assertEqual("teacher-translation", tasks[0]["kind"])
        self.assertEqual("source-changed", tasks[0]["reason"])
        self.assertEqual(new_checksum, tasks[0]["sourceChecksum"])


if __name__ == "__main__":
    unittest.main()
