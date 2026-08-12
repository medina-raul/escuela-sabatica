from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from site_maintenance import (  # noqa: E402
    CommandResult,
    LocalChangesBackup,
    MaintenanceError,
    ensure_repository_ready,
    load_config,
    path_is_allowed,
    preserve_tracked_changes,
    repository_from_url,
    restore_tracked_changes,
)


class FakeRunner:
    def __init__(self, responses: dict[tuple[str, ...], tuple[int, str]]) -> None:
        self.responses = responses
        self.commands: list[list[str]] = []

    def run(self, command: list[str], **_kwargs: object) -> CommandResult:
        self.commands.append(command)
        returncode, output = self.responses.get(tuple(command), (0, ""))
        return CommandResult(command, returncode, output)


class SiteMaintenanceTests(unittest.TestCase):
    def test_repository_from_https_url(self) -> None:
        self.assertEqual(
            "medina-raul/escuela-sabatica",
            repository_from_url("https://github.com/medina-raul/escuela-sabatica.git"),
        )

    def test_repository_from_ssh_url(self) -> None:
        self.assertEqual(
            "jsilvacode/escuela-sabatica",
            repository_from_url("git@github.com:jsilvacode/escuela-sabatica.git"),
        )

    def test_non_github_url_is_rejected(self) -> None:
        self.assertIsNone(repository_from_url("https://example.com/repository.git"))

    def test_allowed_directory_accepts_descendants(self) -> None:
        allowed = ["public/recursos/", "public/resource-manifest.json"]
        self.assertTrue(path_is_allowed("public/recursos/2026-q3/ppt/leccion-01.pptx", allowed))
        self.assertTrue(path_is_allowed("public/resource-manifest.json", allowed))

    def test_similar_prefix_is_not_allowed(self) -> None:
        self.assertFalse(path_is_allowed("public/recursos-antiguos/file.html", ["public/recursos/"]))

    def test_configuration_requires_publication_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({"schemaVersion": 1}), encoding="utf-8")
            with self.assertRaisesRegex(Exception, "Configuración incompleta"):
                load_config(path)

    def test_integral_update_refuses_non_main_branch(self) -> None:
        runner = FakeRunner(
            {
                ("git", "rev-parse", "--show-toplevel"): (0, str(SCRIPTS_DIR.parent)),
                ("git", "branch", "--show-current"): (0, "feature/content\n"),
            }
        )
        config = {"baseBranch": "main", "officialRepository": "owner/repo", "allowedChangePaths": ["public/"]}
        with self.assertRaisesRegex(MaintenanceError, "sólo opera desde `main`"):
            ensure_repository_ready(runner, config)

    def test_integral_update_refuses_tracked_changes(self) -> None:
        runner = FakeRunner(
            {
                ("git", "rev-parse", "--show-toplevel"): (0, str(SCRIPTS_DIR.parent)),
                ("git", "branch", "--show-current"): (0, "main\n"),
                ("git", "diff", "--quiet"): (1, ""),
                ("git", "diff", "--cached", "--quiet"): (0, ""),
            }
        )
        config = {"baseBranch": "main", "officialRepository": "owner/repo", "allowedChangePaths": ["public/"]}
        with self.assertRaisesRegex(MaintenanceError, "Hay cambios locales"):
            ensure_repository_ready(runner, config)

    def test_tracked_changes_are_preserved_in_a_git_stash(self) -> None:
        runner = FakeRunner(
            {
                ("git", "diff", "--quiet"): (1, ""),
                ("git", "diff", "--cached", "--quiet"): (0, ""),
                ("git", "diff", "--name-only"): (0, "src/data/quarters/2026-q3.json\n"),
                ("git", "diff", "--cached", "--name-only"): (0, ""),
                ("git", "stash", "list", "-1", "--format=%gd"): (0, "stash@{0}\n"),
            }
        )
        backup = preserve_tracked_changes(runner)
        self.assertIsNotNone(backup)
        assert backup is not None
        self.assertEqual("stash@{0}", backup.stash_ref)
        self.assertEqual(["src/data/quarters/2026-q3.json"], backup.paths)
        self.assertTrue(
            any(command[:3] == ["git", "stash", "push"] for command in runner.commands)
        )

    def test_conflicted_restore_keeps_stash_for_recovery(self) -> None:
        runner = FakeRunner(
            {
                ("git", "stash", "apply", "--index", "stash@{0}"): (1, "conflict\n"),
            }
        )
        restored, detail = restore_tracked_changes(
            runner,
            LocalChangesBackup(stash_ref="stash@{0}", paths=["src/example.ts"]),
        )
        self.assertFalse(restored)
        self.assertIn("conflict", detail or "")
        self.assertIn(["git", "reset", "--merge"], runner.commands)

    def test_successful_restore_drops_temporary_stash(self) -> None:
        runner = FakeRunner({})
        restored, detail = restore_tracked_changes(
            runner,
            LocalChangesBackup(stash_ref="stash@{0}", paths=["src/example.ts"]),
        )
        self.assertTrue(restored)
        self.assertIsNone(detail)
        self.assertIn(["git", "stash", "drop", "stash@{0}"], runner.commands)


if __name__ == "__main__":
    unittest.main()
